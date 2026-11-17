"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  BarcodeIcon,
  CameraIcon,
  ChefHatIcon,
  ImageUpIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type {
  BodyWeightLog,
  CalorieLog,
  DiaryMealSlot,
  FoodDictionaryItem,
  IngredientUnit,
  MealCategory,
  MealPlanEntryWithRecipe,
  MealSlot,
  NutritionGoalMode,
  NutritionSex,
  NutritionTargets,
  PantryItem,
  RecipeIngredientDraft,
  RecipeWithIngredients,
} from "@life-os/db";
import {
  calculateAiTargetsAction,
  deleteBodyWeightAction,
  deleteCalorieLogAction,
  deleteMealPlanEntryAction,
  deletePantryItemAction,
  deleteRecipeAction,
  logFoodDiaryEntryAction,
  lookupBarcodeFoodAction,
  saveBodyWeightAction,
  saveMealPlanEntryAction,
  saveNutritionTargetsAction,
  savePantryItemAction,
  saveRecipeAction,
  searchFoodAutoLookupAction,
  updateFoodDiaryEntryAction,
} from "@/app/nutrition-actions";
import { cn } from "@/lib/utils";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export const DIARY_SLOT_LABELS_RU: Record<DiaryMealSlot, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус / Другое",
};

export const GOAL_MODE_LABELS_RU: Record<NutritionGoalMode, string> = {
  lose: "Снижение веса",
  recomp: "Рекомпозиция",
  maintain: "Поддержание",
  gain: "Набор массы",
};

function round1(val: number): number {
  return Math.round((val + Number.EPSILON) * 10) / 10;
}

function estimateGramsFromUnit(amount: number, unit: string): number {
  const amt = Math.max(0, Number(amount) || 0);
  switch (unit) {
    case "kg":
    case "l":
      return round1(amt * 1000);
    case "tbsp":
      return round1(amt * 15);
    case "tsp":
      return round1(amt * 5);
    case "pcs":
      return round1(amt * 60);
    case "pack":
      return round1(amt * 200);
    default:
      return round1(amt);
  }
}

const SOURCE_PILL_LABELS: Record<string, string> = {
  open_reference: "Справочник",
  openfoodfacts: "Open Food Facts",
  ai_estimated: "Оценка ИИ",
  user: "Мой продукт",
};

// ============================================================================
// 1. Smart Add / Edit Food Diary Modal (Auto-Lookup + Barcode + Recipes)
// ============================================================================

interface AddFoodModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loggedDate: string;
  defaultSlot: DiaryMealSlot;
  initialMode?: "search" | "barcode" | "recipe";
  defaultRecipeId?: number | null;
  editingEntry?: CalorieLog | null;
  dictionaryHighlights: FoodDictionaryItem[];
  recipes: RecipeWithIngredients[];
  onSaved?: () => void;
}

export function AddFoodModal({
  open,
  onOpenChange,
  loggedDate,
  defaultSlot,
  initialMode = "search",
  defaultRecipeId = null,
  editingEntry = null,
  dictionaryHighlights,
  recipes,
  onSaved,
}: AddFoodModalProps) {
  const [pending, startTransition] = React.useTransition();

  const [slot, setSlot] = React.useState<DiaryMealSlot>(defaultSlot);
  const [mode, setMode] = React.useState<"search" | "barcode" | "recipe">(
    initialMode
  );

  // Search & Selected Food Item state
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<FoodDictionaryItem[]>(
    dictionaryHighlights
  );
  const [selectedFood, setSelectedFood] =
    React.useState<FoodDictionaryItem | null>(null);

  // Per-100g macros + portion grams (live scaling!)
  const [customTitle, setCustomTitle] = React.useState("");
  const [kcal100, setKcal100] = React.useState("");
  const [prot100, setProt100] = React.useState("");
  const [fat100, setFat100] = React.useState("");
  const [carb100, setCarb100] = React.useState("");
  const [grams, setGrams] = React.useState("100");

  // Barcode scanner state
  const [barcodeText, setBarcodeText] = React.useState("");
  const [barcodeStatus, setBarcodeStatus] = React.useState<string | null>(null);
  const [barcodeNotFound, setBarcodeNotFound] = React.useState(false);
  const [cameraActive, setCameraActive] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const scanTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Recipe logging state
  const [selectedRecipeId, setSelectedRecipeId] = React.useState<string>("");
  const [recipeScaleBy, setRecipeScaleBy] = React.useState<"servings" | "grams">(
    "servings"
  );
  const [recipeServings, setRecipeServings] = React.useState("1");
  const [recipeGrams, setRecipeGrams] = React.useState("");

  // Edit existing entry state
  const [editTitle, setEditTitle] = React.useState("");
  const [editGrams, setEditGrams] = React.useState("");
  const [editKcal, setEditKcal] = React.useState("");
  const [editProt, setEditProt] = React.useState("");
  const [editFat, setEditFat] = React.useState("");
  const [editCarb, setEditCarb] = React.useState("");

  const stopCamera = React.useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  React.useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    setSlot(
      editingEntry
        ? (editingEntry.meal_slot as DiaryMealSlot)
        : defaultSlot
    );

    if (editingEntry) {
      setEditTitle(editingEntry.title);
      setEditGrams(editingEntry.grams ? String(editingEntry.grams) : "");
      setEditKcal(String(editingEntry.kcal));
      setEditProt(
        editingEntry.protein_g !== null ? String(editingEntry.protein_g) : "0"
      );
      setEditFat(editingEntry.fat_g !== null ? String(editingEntry.fat_g) : "0");
      setEditCarb(
        editingEntry.carbs_g !== null ? String(editingEntry.carbs_g) : "0"
      );
      return;
    }

    setMode(defaultRecipeId ? "recipe" : initialMode);
    setQuery("");
    setResults(dictionaryHighlights);
    setSelectedFood(null);
    setCustomTitle("");
    setKcal100("");
    setProt100("");
    setFat100("");
    setCarb100("");
    setGrams("100");
    setBarcodeText("");
    setBarcodeStatus(null);
    setBarcodeNotFound(false);

    const firstRec = defaultRecipeId
      ? recipes.find((r) => r.id === defaultRecipeId) ?? recipes[0]
      : recipes[0];
    setSelectedRecipeId(firstRec ? String(firstRec.id) : "");
    setRecipeScaleBy("servings");
    setRecipeServings("1");
    if (firstRec && firstRec.total_weight_g && firstRec.default_servings) {
      setRecipeGrams(
        String(
          Math.round(
            Number(firstRec.total_weight_g) /
              Math.max(1, Number(firstRec.default_servings))
          )
        )
      );
    } else {
      setRecipeGrams("250");
    }
  }, [
    open,
    defaultSlot,
    initialMode,
    defaultRecipeId,
    editingEntry,
    dictionaryHighlights,
    recipes,
    stopCamera,
  ]);

  // Debounced 3-Tier Open Food Search
  React.useEffect(() => {
    if (!open || editingEntry || mode !== "search") return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(dictionaryHighlights);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const items = await searchFoodAutoLookupAction(trimmed, {
          allowRemote: trimmed.length >= 3,
          limit: 10,
        });
        if (!cancelled) {
          setResults(items);
          if (items[0] && !selectedFood) {
            applyFoodSelection(items[0]);
          }
        }
      } catch {
        // Ignore transient network errors
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, editingEntry, mode, query, dictionaryHighlights, selectedFood]);

  function applyFoodSelection(item: FoodDictionaryItem) {
    setSelectedFood(item);
    setCustomTitle(item.display_name);
    setKcal100(String(item.kcal_100g));
    setProt100(String(item.protein_100g));
    setFat100(String(item.fat_100g));
    setCarb100(String(item.carbs_100g));
    setGrams(String(item.default_portion_g || 100));
    setBarcodeNotFound(false);
  }

  // Live scaled portion macros for Search / Barcode mode
  const portionGramsNum = Math.max(0, Number(grams) || 0);
  const scaledPortion = React.useMemo(() => {
    const ratio = portionGramsNum / 100;
    return {
      kcal: Math.round((Number(kcal100) || 0) * ratio),
      protein: round1((Number(prot100) || 0) * ratio),
      fat: round1((Number(fat100) || 0) * ratio),
      carbs: round1((Number(carb100) || 0) * ratio),
    };
  }, [portionGramsNum, kcal100, prot100, fat100, carb100]);

  // Live scaled macros for Recipe mode
  const chosenRecipe = React.useMemo(
    () => recipes.find((r) => String(r.id) === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId]
  );

  const scaledRecipeMacros = React.useMemo(() => {
    if (!chosenRecipe) {
      return { kcal: 0, protein: 0, fat: 0, carbs: 0, grams: 0, servings: 1 };
    }
    const totalW = Number(chosenRecipe.total_weight_g ?? 0);
    const defServ = Math.max(1, Number(chosenRecipe.default_servings ?? 1));
    if (recipeScaleBy === "grams" && totalW > 0 && chosenRecipe.total_kcal !== null) {
      const g = Math.max(0, Number(recipeGrams) || 0);
      const ratio = g / totalW;
      return {
        kcal: Math.round(Number(chosenRecipe.total_kcal) * ratio),
        protein: round1(Number(chosenRecipe.total_protein_g ?? 0) * ratio),
        fat: round1(Number(chosenRecipe.total_fat_g ?? 0) * ratio),
        carbs: round1(Number(chosenRecipe.total_carbs_g ?? 0) * ratio),
        grams: round1(g),
        servings: round1(ratio * defServ),
      };
    }
    const s = Math.max(0.1, Number(recipeServings) || 1);
    return {
      kcal: Math.round(Number(chosenRecipe.kcal_per_serving ?? 0) * s),
      protein: round1(Number(chosenRecipe.protein_g ?? 0) * s),
      fat: round1(Number(chosenRecipe.fat_g ?? 0) * s),
      carbs: round1(Number(chosenRecipe.carbs_g ?? 0) * s),
      grams: totalW > 0 ? round1((totalW / defServ) * s) : 0,
      servings: s,
    };
  }, [chosenRecipe, recipeScaleBy, recipeServings, recipeGrams]);

  // Barcode handlers
  async function handleBarcodeLookupCode(code: string) {
    const clean = code.trim();
    if (!clean) return;
    setSearching(true);
    setBarcodeStatus("Ищем штрихкод в Open Food Facts и справочнике…");
    try {
      const { item, offProduct } = await lookupBarcodeFoodAction(clean);
      setBarcodeText(offProduct.barcode || clean);
      if (item) {
        applyFoodSelection(item);
        setBarcodeStatus(`Найдено: ${item.display_name} (${clean})`);
        setBarcodeNotFound(false);
      } else if (offProduct.found && offProduct.product_name) {
        setSelectedFood(null);
        setCustomTitle(offProduct.product_name);
        setKcal100(String(offProduct.kcal_100g ?? 0));
        setProt100(String(offProduct.protein_100g ?? 0));
        setFat100(String(offProduct.fat_100g ?? 0));
        setCarb100(String(offProduct.carbs_100g ?? 0));
        setGrams("100");
        setBarcodeStatus(`Найдено в Open Food Facts: ${offProduct.product_name}`);
        setBarcodeNotFound(false);
      } else {
        setSelectedFood(null);
        setBarcodeNotFound(true);
        setBarcodeStatus(
          `Код ${clean} пока не занесён в Open Food Facts — введи название и КБЖУ на 100 г один раз, и он сохранится навсегда.`
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка поиска штрихкода");
    } finally {
      setSearching(false);
    }
  }

  async function handleDecodeBarcodeBlob(blob: Blob, quiet = false) {
    if (!quiet) {
      setSearching(true);
      setBarcodeStatus("Распознаём штрихкод на изображении…");
    }
    try {
      const fd = new FormData();
      fd.set("file", blob, "barcode.jpg");
      const res = await fetch("/api/nutrition/barcode", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        decoded?: boolean;
        barcode?: string;
        item?: FoodDictionaryItem | null;
        offProduct?: {
          found: boolean;
          product_name: string | null;
          kcal_100g: number | null;
          protein_100g: number | null;
          fat_100g: number | null;
          carbs_100g: number | null;
        };
        error?: string;
      };
      if (!res.ok) {
        if (!quiet) toast.error(data.error || "Ошибка сканера");
        return false;
      }
      if (!data.decoded || !data.barcode) {
        if (!quiet) {
          setBarcodeStatus(
            data.error ||
              "Полоски штрихкода не распознаны. Сфотографируй крупнее или введи цифры ниже."
          );
        }
        return false;
      }

      stopCamera();
      setBarcodeText(data.barcode);
      if (data.item) {
        applyFoodSelection(data.item);
        setBarcodeStatus(`Распознан штрихкод ${data.barcode}: ${data.item.display_name}`);
        setBarcodeNotFound(false);
        toast.success(`Найден продукт: ${data.item.display_name}`);
      } else if (data.offProduct?.found && data.offProduct.product_name) {
        setSelectedFood(null);
        setCustomTitle(data.offProduct.product_name);
        setKcal100(String(data.offProduct.kcal_100g ?? 0));
        setProt100(String(data.offProduct.protein_100g ?? 0));
        setFat100(String(data.offProduct.fat_100g ?? 0));
        setCarb100(String(data.offProduct.carbs_100g ?? 0));
        setGrams("100");
        setBarcodeStatus(`Распознан код ${data.barcode}: ${data.offProduct.product_name}`);
        setBarcodeNotFound(false);
      } else {
        setSelectedFood(null);
        setBarcodeNotFound(true);
        setBarcodeStatus(
          `Штрихкод ${data.barcode} считан! Укажи название и КБЖУ на 100 г для сохранения в твою базу.`
        );
      }
      return true;
    } catch {
      if (!quiet) toast.error("Не удалось обработать фото штрихкода");
      return false;
    } finally {
      if (!quiet) setSearching(false);
    }
  }

  async function startLiveCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Браузер не дал доступ к камере — используй кнопку «Фото штрихкода»");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setBarcodeStatus("Наведи камеру на штрихкод упаковки…");

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 80);

      let busy = false;
      scanTimerRef.current = setInterval(async () => {
        if (busy || !videoRef.current || videoRef.current.readyState < 2) return;
        busy = true;
        try {
          const v = videoRef.current;
          const canvas = document.createElement("canvas");
          canvas.width = v.videoWidth || 640;
          canvas.height = v.videoHeight || 480;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, "image/jpeg", 0.85)
            );
            if (blob) {
              await handleDecodeBarcodeBlob(blob, true);
            }
          }
        } finally {
          busy = false;
        }
      }, 950);
    } catch {
      toast.error("Доступ к камере отклонён — используй загрузку фото штрихкода");
    }
  }

  function handleEditGramsRescale(nextGrams: string) {
    setEditGrams(nextGrams);
    if (!editingEntry || !editingEntry.grams || Number(editingEntry.grams) <= 0) {
      return;
    }
    const g = Number(nextGrams);
    if (g > 0) {
      const ratio = g / Number(editingEntry.grams);
      setEditKcal(String(Math.round(Number(editingEntry.kcal) * ratio)));
      setEditProt(
        String(round1(Number(editingEntry.protein_g ?? 0) * ratio))
      );
      setEditFat(String(round1(Number(editingEntry.fat_g ?? 0) * ratio)));
      setEditCarb(String(round1(Number(editingEntry.carbs_g ?? 0) * ratio)));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (editingEntry) {
          await updateFoodDiaryEntryAction({
            id: editingEntry.id,
            meal_slot: slot,
            title: editTitle,
            grams: editGrams ? Number(editGrams) : null,
            kcal: Math.max(0, Math.round(Number(editKcal) || 0)),
            protein_g: Number(editProt) || 0,
            fat_g: Number(editFat) || 0,
            carbs_g: Number(editCarb) || 0,
          });
          toast.success("Запись в дневнике обновлена");
          onSaved?.();
          onOpenChange(false);
          return;
        }

        if (mode === "recipe") {
          if (!chosenRecipe) {
            toast.error("Выбери рецепт из списка");
            return;
          }
          await logFoodDiaryEntryAction({
            logged_date: loggedDate,
            meal_slot: slot,
            recipe_id: chosenRecipe.id,
            servings:
              recipeScaleBy === "servings"
                ? Number(recipeServings) || 1
                : scaledRecipeMacros.servings,
            grams:
              recipeScaleBy === "grams"
                ? Number(recipeGrams) || null
                : scaledRecipeMacros.grams || null,
            source: "recipe",
          });
          toast.success(`«${chosenRecipe.title}» добавлено в ${DIARY_SLOT_LABELS_RU[slot].toLowerCase()}`);
          onSaved?.();
          onOpenChange(false);
          return;
        }

        const effectiveTitle = (customTitle || query).trim();
        if (!effectiveTitle) {
          toast.error("Укажи продукт или выбери его из поиска");
          return;
        }

        const hasPer100 = kcal100 !== "" && Number.isFinite(Number(kcal100));

        await logFoodDiaryEntryAction({
          logged_date: loggedDate,
          meal_slot: slot,
          title: effectiveTitle,
          food_item_id: selectedFood?.id ?? null,
          barcode: barcodeText.trim() || selectedFood?.barcode || null,
          grams: portionGramsNum || 100,
          kcal: hasPer100 ? scaledPortion.kcal : null,
          protein_g: hasPer100 ? scaledPortion.protein : null,
          fat_g: hasPer100 ? scaledPortion.fat : null,
          carbs_g: hasPer100 ? scaledPortion.carbs : null,
          source: mode === "barcode" ? "barcode" : "web",
          cacheCustomBarcodeItem:
            mode === "barcode" &&
            barcodeNotFound &&
            barcodeText.trim() &&
            hasPer100
              ? {
                  display_name: effectiveTitle,
                  barcode: barcodeText.trim(),
                  kcal_100g: Number(kcal100) || 0,
                  protein_100g: Number(prot100) || 0,
                  fat_100g: Number(fat100) || 0,
                  carbs_100g: Number(carb100) || 0,
                }
              : null,
        });

        toast.success(`Добавлено в ${DIARY_SLOT_LABELS_RU[slot].toLowerCase()}`);
        onSaved?.();
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить запись");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) stopCamera();
        onOpenChange(next);
      }}
      title={editingEntry ? "Изменить запись в дневнике" : "Добавить в дневник питания"}
      description={
        editingEntry
          ? "При изменении веса порции калории и БЖУ пересчитываются автоматически."
          : "КБЖУ подтягивается автоматически из справочника, Open Food Facts, по штрихкоду или из рецептов."
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Meal Slot Picker */}
        <ToggleGroup
          type="single"
          value={slot}
          onValueChange={(v) => v && setSlot(v as DiaryMealSlot)}
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-4"
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

        {editingEntry ? (
          <FieldGroup className="gap-3.5">
            <Field>
              <FieldLabel htmlFor="ed-food-title">Продукт / блюдо</FieldLabel>
              <Input
                id="ed-food-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
                className="min-h-11"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="ed-food-g">Вес порции (г)</FieldLabel>
                <Input
                  id="ed-food-g"
                  type="number"
                  min={1}
                  step="any"
                  value={editGrams}
                  onChange={(e) => handleEditGramsRescale(e.target.value)}
                  className="min-h-11 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ed-food-kcal">Калории (ккал)</FieldLabel>
                <Input
                  id="ed-food-kcal"
                  type="number"
                  min={0}
                  value={editKcal}
                  onChange={(e) => setEditKcal(e.target.value)}
                  required
                  className="min-h-11 font-semibold num-tabular"
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <Field>
                <FieldLabel htmlFor="ed-p">Белки (г)</FieldLabel>
                <Input
                  id="ed-p"
                  type="number"
                  min={0}
                  step="0.1"
                  value={editProt}
                  onChange={(e) => setEditProt(e.target.value)}
                  className="min-h-10 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ed-f">Жиры (г)</FieldLabel>
                <Input
                  id="ed-f"
                  type="number"
                  min={0}
                  step="0.1"
                  value={editFat}
                  onChange={(e) => setEditFat(e.target.value)}
                  className="min-h-10 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ed-c">Углеводы (г)</FieldLabel>
                <Input
                  id="ed-c"
                  type="number"
                  min={0}
                  step="0.1"
                  value={editCarb}
                  onChange={(e) => setEditCarb(e.target.value)}
                  className="min-h-10 num-tabular"
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteCalorieLogAction(editingEntry.id);
                    toast("Запись удалена из дневника");
                    onSaved?.();
                    onOpenChange(false);
                  })
                }
                className="min-h-11 rounded-xl text-destructive hover:text-destructive"
              >
                <Trash2Icon data-icon="inline-start" />
                Удалить
              </Button>

              <Button
                type="submit"
                disabled={pending}
                className="min-h-11 flex-1 rounded-xl sm:flex-initial sm:px-6"
              >
                Сохранить изменения
              </Button>
            </div>
          </FieldGroup>
        ) : (
          <>
            {/* Mode Switcher: Search | Barcode | Recipe */}
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => {
                if (v === "search" || v === "barcode" || v === "recipe") {
                  if (v !== "barcode") stopCamera();
                  setMode(v);
                }
              }}
              variant="outline"
              spacing={1}
              className="grid w-full grid-cols-3 gap-1.5"
            >
              <ToggleGroupItem value="search" className="min-h-10 text-xs">
                <SearchIcon data-icon="inline-start" />
                Поиск продукта
              </ToggleGroupItem>
              <ToggleGroupItem value="barcode" className="min-h-10 text-xs">
                <BarcodeIcon data-icon="inline-start" />
                Штрихкод
              </ToggleGroupItem>
              <ToggleGroupItem value="recipe" className="min-h-10 text-xs">
                <ChefHatIcon data-icon="inline-start" />
                Из рецептов
              </ToggleGroupItem>
            </ToggleGroup>

            {/* MODE 1: SEARCH PRODUCT */}
            {mode === "search" ? (
              <div className="flex flex-col gap-3.5">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        if (!selectedFood) setCustomTitle(e.target.value);
                      }}
                      placeholder="Начни вводить: творог 5%, куриная грудка, банан, овсянка…"
                      className="min-h-11 pl-9"
                    />
                  </div>
                  {query.trim().length >= 2 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={searching}
                      onClick={async () => {
                        setSearching(true);
                        try {
                          const items = await searchFoodAutoLookupAction(
                            query.trim(),
                            { allowRemote: true, limit: 8 }
                          );
                          setResults(items);
                          if (items[0]) applyFoodSelection(items[0]);
                        } finally {
                          setSearching(false);
                        }
                      }}
                      className="min-h-11 shrink-0 rounded-xl"
                    >
                      {searching ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <SparklesIcon data-icon="inline-start" />
                      )}
                      Найти КБЖУ
                    </Button>
                  ) : null}
                </div>

                {/* Live Autocomplete Results */}
                <div className="flex max-h-[180px] flex-col gap-1.5 overflow-y-auto rounded-xl border border-border/80 bg-muted/25 p-2">
                  {results.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">
                      Нажми «Найти КБЖУ», чтобы подтянуть продукт из Open Food Facts или рассчитать через ИИ.
                    </p>
                  ) : (
                    results.map((item) => {
                      const active = selectedFood?.id === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => applyFoodSelection(item)}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                            active
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted/70"
                          )}
                        >
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate font-medium text-sm">
                              {item.display_name}
                            </span>
                            <span className="text-[11px] text-muted-foreground num-tabular">
                              На 100 г: Б {item.protein_100g} · Ж {item.fat_100g} · У{" "}
                              {item.carbs_100g}
                            </span>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-0.5 num-tabular">
                            <span className="text-sm font-semibold">
                              {Math.round(Number(item.kcal_100g))} ккал
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {SOURCE_PILL_LABELS[item.source] ?? item.source}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}

            {/* MODE 2: OPTICAL BARCODE SCANNER */}
            {mode === "barcode" ? (
              <div className="flex flex-col gap-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="barcode-photo-input"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void handleDecodeBarcodeBlob(f, false);
                    }}
                  />
                  <Button
                    asChild
                    variant="secondary"
                    size="sm"
                    className="min-h-10 flex-1 cursor-pointer rounded-xl"
                  >
                    <label htmlFor="barcode-photo-input">
                      <ImageUpIcon data-icon="inline-start" />
                      Фото / Скан штрихкода
                    </label>
                  </Button>

                  {!cameraActive ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void startLiveCamera()}
                      className="min-h-10 flex-1 rounded-xl"
                    >
                      <CameraIcon data-icon="inline-start" />
                      Живая камера
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={stopCamera}
                      className="min-h-10 rounded-xl"
                    >
                      <XIcon data-icon="inline-start" />
                      Стоп камера
                    </Button>
                  )}
                </div>

                {cameraActive ? (
                  <div className="overflow-hidden rounded-xl border border-primary/40 bg-black">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="h-44 w-full object-cover"
                    />
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Input
                    value={barcodeText}
                    onChange={(e) => setBarcodeText(e.target.value)}
                    placeholder="Или введи цифры штрихкода (напр. 3017620422003)"
                    className="min-h-10 flex-1 num-tabular"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={searching}
                    onClick={() => void handleBarcodeLookupCode(barcodeText)}
                    className="min-h-10 shrink-0 rounded-xl"
                  >
                    Найти по коду
                  </Button>
                </div>

                {barcodeStatus ? (
                  <p className="rounded-xl bg-muted/55 px-3 py-2 text-xs text-muted-foreground">
                    {barcodeStatus}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* SHARED PORTION & AUTO-MACRO PREVIEW FOR SEARCH + BARCODE */}
            {mode === "search" || mode === "barcode" ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-border/85 bg-card p-3.5">
                <Field>
                  <FieldLabel htmlFor="af-title">Название в дневнике</FieldLabel>
                  <Input
                    id="af-title"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Выбери выше или введи название продукта"
                    required
                    className="min-h-10"
                  />
                </Field>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="af-grams">Вес порции (г / мл)</FieldLabel>
                    <div className="flex flex-wrap gap-1">
                      {["50", "100", "150", "200", "250"].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setGrams(preset)}
                          className={cn(
                            "rounded-lg border px-2 py-0.5 text-xs num-tabular",
                            grams === preset
                              ? "border-primary bg-accent font-medium text-foreground"
                              : "border-border/80 text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {preset} г
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input
                    id="af-grams"
                    type="number"
                    min={1}
                    step="any"
                    value={grams}
                    onChange={(e) => setGrams(e.target.value)}
                    className="min-h-11 text-base font-semibold num-tabular"
                  />
                </div>

                {/* Per 100g editable reference */}
                <div className="grid grid-cols-4 gap-2">
                  <Field>
                    <FieldLabel htmlFor="af-k100" className="text-[11px]">
                      Ккал/100г
                    </FieldLabel>
                    <Input
                      id="af-k100"
                      type="number"
                      min={0}
                      step="any"
                      value={kcal100}
                      onChange={(e) => setKcal100(e.target.value)}
                      placeholder="Авто"
                      className="min-h-9 text-xs num-tabular"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="af-p100" className="text-[11px]">
                      Б/100г
                    </FieldLabel>
                    <Input
                      id="af-p100"
                      type="number"
                      min={0}
                      step="0.1"
                      value={prot100}
                      onChange={(e) => setProt100(e.target.value)}
                      placeholder="0"
                      className="min-h-9 text-xs num-tabular"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="af-f100" className="text-[11px]">
                      Ж/100г
                    </FieldLabel>
                    <Input
                      id="af-f100"
                      type="number"
                      min={0}
                      step="0.1"
                      value={fat100}
                      onChange={(e) => setFat100(e.target.value)}
                      placeholder="0"
                      className="min-h-9 text-xs num-tabular"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="af-c100" className="text-[11px]">
                      У/100г
                    </FieldLabel>
                    <Input
                      id="af-c100"
                      type="number"
                      min={0}
                      step="0.1"
                      value={carb100}
                      onChange={(e) => setCarb100(e.target.value)}
                      placeholder="0"
                      className="min-h-9 text-xs num-tabular"
                    />
                  </Field>
                </div>

                {/* Live Calculated Portion Summary */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent/65 px-3.5 py-2.5 num-tabular">
                  <span className="text-xs font-medium text-accent-foreground">
                    Итого на {portionGramsNum || 0} г:
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-base font-semibold text-foreground">
                      {scaledPortion.kcal} ккал
                    </span>
                    <span>Б {scaledPortion.protein} г</span>
                    <span>Ж {scaledPortion.fat} г</span>
                    <span>У {scaledPortion.carbs} г</span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* MODE 3: FROM SAVED RECIPES */}
            {mode === "recipe" ? (
              <div className="flex flex-col gap-3.5 rounded-2xl border border-border/85 bg-card p-3.5">
                <Field>
                  <FieldLabel>Выбери блюдо из твоих рецептов</FieldLabel>
                  <Select
                    value={selectedRecipeId}
                    onValueChange={(v) => {
                      setSelectedRecipeId(v);
                      const r = recipes.find((x) => String(x.id) === v);
                      if (r && r.total_weight_g && r.default_servings) {
                        setRecipeGrams(
                          String(
                            Math.round(
                              Number(r.total_weight_g) /
                                Math.max(1, Number(r.default_servings))
                            )
                          )
                        );
                      }
                    }}
                  >
                    <SelectTrigger className="min-h-11 w-full">
                      <SelectValue placeholder="Выбери рецепт" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {recipes.map((r) => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            {r.title} ({r.kcal_per_serving ?? 0} ккал/порц.)
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <ToggleGroup
                  type="single"
                  value={recipeScaleBy}
                  onValueChange={(v) => {
                    if (v === "servings" || v === "grams") setRecipeScaleBy(v);
                  }}
                  variant="outline"
                  spacing={1}
                  className="grid w-full grid-cols-2 gap-1"
                >
                  <ToggleGroupItem value="servings" className="min-h-9 text-xs">
                    По порциям
                  </ToggleGroupItem>
                  <ToggleGroupItem value="grams" className="min-h-9 text-xs">
                    По весу (г)
                  </ToggleGroupItem>
                </ToggleGroup>

                {recipeScaleBy === "servings" ? (
                  <Field>
                    <FieldLabel htmlFor="rec-log-serv">Количество порций</FieldLabel>
                    <Input
                      id="rec-log-serv"
                      type="number"
                      min={0.25}
                      max={10}
                      step={0.25}
                      value={recipeServings}
                      onChange={(e) => setRecipeServings(e.target.value)}
                      className="min-h-11 text-base font-semibold num-tabular"
                    />
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="rec-log-g">Вес порции (г)</FieldLabel>
                    <Input
                      id="rec-log-g"
                      type="number"
                      min={10}
                      step={5}
                      value={recipeGrams}
                      onChange={(e) => setRecipeGrams(e.target.value)}
                      className="min-h-11 text-base font-semibold num-tabular"
                    />
                  </Field>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent/65 px-3.5 py-2.5 num-tabular">
                  <span className="text-xs font-medium text-accent-foreground">
                    В дневник ({scaledRecipeMacros.servings} порц.
                    {scaledRecipeMacros.grams > 0
                      ? ` · ~${scaledRecipeMacros.grams} г`
                      : ""}
                    ):
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-base font-semibold text-foreground">
                      {scaledRecipeMacros.kcal} ккал
                    </span>
                    <span>Б {scaledRecipeMacros.protein} г</span>
                    <span>Ж {scaledRecipeMacros.fat} г</span>
                    <span>У {scaledRecipeMacros.carbs} г</span>
                  </div>
                </div>
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={pending}
              className="min-h-11 w-full rounded-xl text-base"
            >
              {pending ? (
                <>
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                  Добавляем…
                </>
              ) : (
                `Добавить в ${DIARY_SLOT_LABELS_RU[slot].toLowerCase()}`
              )}
            </Button>
          </>
        )}
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 2. AI Primary Calorie & Macro Onboarding / Targets Editor Form
// ============================================================================

interface AiTargetsConfiguratorProps {
  targets: NutritionTargets;
  latestWeightKg?: number | null;
  onSaved?: () => void;
  compact?: boolean;
}

export function AiTargetsConfigurator({
  targets,
  latestWeightKg,
  onSaved,
  compact = false,
}: AiTargetsConfiguratorProps) {
  const [aiLoading, setAiLoading] = React.useState(false);
  const [saving, startSave] = React.useTransition();

  const [prompt, setPrompt] = React.useState("");
  const [sex, setSex] = React.useState<NutritionSex>(
    (targets.sex as NutritionSex) ?? "male"
  );
  const [age, setAge] = React.useState(targets.age ? String(targets.age) : "28");
  const [heightCm, setHeightCm] = React.useState(
    targets.height_cm ? String(targets.height_cm) : "178"
  );
  const [weightKg, setWeightKg] = React.useState(
    targets.baseline_weight_kg
      ? String(targets.baseline_weight_kg)
      : latestWeightKg
        ? String(latestWeightKg)
        : "81.6"
  );
  const [targetWeightKg, setTargetWeightKg] = React.useState(
    targets.target_weight_kg ? String(targets.target_weight_kg) : "78"
  );
  const [goalMode, setGoalMode] = React.useState<NutritionGoalMode>(
    (targets.goal_mode as NutritionGoalMode) ?? "recomp"
  );

  const [kcalTarget, setKcalTarget] = React.useState(String(targets.kcal_target));
  const [protTarget, setProtTarget] = React.useState(
    String(targets.protein_target_g)
  );
  const [fatTarget, setFatTarget] = React.useState(String(targets.fat_target_g));
  const [carbTarget, setCarbTarget] = React.useState(
    String(targets.carbs_target_g)
  );
  const [explanation, setExplanation] = React.useState(
    targets.ai_explanation ?? ""
  );
  const [showNumbers, setShowNumbers] = React.useState(
    targets.is_configured || compact
  );

  async function handleRunAi() {
    setAiLoading(true);
    try {
      const res = await calculateAiTargetsAction({
        prompt: prompt.trim() || null,
        sex,
        age: Number(age) || null,
        heightCm: Number(heightCm) || null,
        weightKg: Number(weightKg) || null,
        targetWeightKg: targetWeightKg ? Number(targetWeightKg) : null,
        goalMode,
      });
      setKcalTarget(String(res.kcal_target));
      setProtTarget(String(res.protein_target_g));
      setFatTarget(String(res.fat_target_g));
      setCarbTarget(String(res.carbs_target_g));
      setGoalMode(res.goal_mode);
      if (res.target_weight_kg) setTargetWeightKg(String(res.target_weight_kg));
      setExplanation(res.ai_explanation);
      setShowNumbers(true);
      toast.success("ИИ рассчитал персональную норму КБЖУ");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка расчёта ИИ");
    } finally {
      setAiLoading(false);
    }
  }

  function handleSaveTargets(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      try {
        await saveNutritionTargetsAction({
          kcal_target: Number(kcalTarget) || 2200,
          protein_target_g: Number(protTarget) || 150,
          fat_target_g: Number(fatTarget) || 73,
          carbs_target_g: Number(carbTarget) || 235,
          goal_mode: goalMode,
          sex,
          age: Number(age) || null,
          height_cm: Number(heightCm) || null,
          baseline_weight_kg: Number(weightKg) || null,
          target_weight_kg: targetWeightKg ? Number(targetWeightKg) : null,
          ai_explanation: explanation || null,
          configured_via: explanation ? "ai" : "manual",
          logBaselineWeight: !targets.is_configured,
        });
        toast.success("Персональная норма КБЖУ сохранена!");
        onSaved?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить норму");
      }
    });
  }

  return (
    <form onSubmit={handleSaveTargets} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <Textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Опиши себя свободно: например «Мужчина, 28 лет, 178 см, 81.6 кг, 3 силовые в неделю, сидячая работа, хочу комфортно снизить вес до 78 кг без потери мышц»"
        />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <Select value={sex} onValueChange={(v) => setSex(v as NutritionSex)}>
            <SelectTrigger className="min-h-9 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="male">Мужчина</SelectItem>
                <SelectItem value="female">Женщина</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Input
            type="number"
            min={14}
            max={100}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="Лет"
            aria-label="Возраст"
            className="min-h-9 text-xs num-tabular"
          />

          <Input
            type="number"
            min={120}
            max={230}
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="Рост см"
            aria-label="Рост (см)"
            className="min-h-9 text-xs num-tabular"
          />

          <Input
            type="number"
            min={35}
            max={250}
            step="0.1"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="Вес кг"
            aria-label="Текущий вес (кг)"
            className="min-h-9 text-xs num-tabular"
          />

          <Input
            type="number"
            min={35}
            max={250}
            step="0.1"
            value={targetWeightKg}
            onChange={(e) => setTargetWeightKg(e.target.value)}
            placeholder="Цель кг"
            aria-label="Целевой вес (кг)"
            className="min-h-9 text-xs num-tabular"
          />

          <Select
            value={goalMode}
            onValueChange={(v) => setGoalMode(v as NutritionGoalMode)}
          >
            <SelectTrigger className="min-h-9 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.entries(GOAL_MODE_LABELS_RU).map(([k, lbl]) => (
                  <SelectItem key={k} value={k}>
                    {lbl}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button
            type="button"
            variant={showNumbers ? "secondary" : "default"}
            size="sm"
            disabled={aiLoading}
            onClick={() => void handleRunAi()}
            className="min-h-10 rounded-xl"
          >
            {aiLoading ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <SparklesIcon data-icon="inline-start" />
            )}
            {aiLoading ? "ИИ рассчитывает норму…" : "Рассчитать через ИИ"}
          </Button>

          {!showNumbers ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowNumbers(true)}
              className="min-h-10 rounded-xl text-xs"
            >
              Задать цифры вручную
            </Button>
          ) : null}
        </div>
      </div>

      {explanation ? (
        <div className="rounded-xl border border-primary/25 bg-accent/55 p-3 text-xs leading-relaxed text-foreground">
          {explanation}
        </div>
      ) : null}

      {showNumbers ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background/80 p-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="nt-kcal" className="text-xs">
                Норма ккал
              </FieldLabel>
              <Input
                id="nt-kcal"
                type="number"
                min={800}
                max={10000}
                value={kcalTarget}
                onChange={(e) => setKcalTarget(e.target.value)}
                required
                className="min-h-10 font-semibold num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nt-p" className="text-xs">
                Белки (г)
              </FieldLabel>
              <Input
                id="nt-p"
                type="number"
                min={20}
                step="0.5"
                value={protTarget}
                onChange={(e) => setProtTarget(e.target.value)}
                required
                className="min-h-10 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nt-f" className="text-xs">
                Жиры (г)
              </FieldLabel>
              <Input
                id="nt-f"
                type="number"
                min={15}
                step="0.5"
                value={fatTarget}
                onChange={(e) => setFatTarget(e.target.value)}
                required
                className="min-h-10 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nt-c" className="text-xs">
                Углеводы (г)
              </FieldLabel>
              <Input
                id="nt-c"
                type="number"
                min={0}
                step="0.5"
                value={carbTarget}
                onChange={(e) => setCarbTarget(e.target.value)}
                required
                className="min-h-10 num-tabular"
              />
            </Field>
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="min-h-10 w-full rounded-xl sm:self-end sm:w-auto sm:px-6"
          >
            Сохранить мою норму
          </Button>
        </div>
      ) : null}
    </form>
  );
}

interface NutritionTargetsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: NutritionTargets;
  latestWeightKg?: number | null;
}

export function NutritionTargetsModal({
  open,
  onOpenChange,
  targets,
  latestWeightKg,
}: NutritionTargetsModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Норма калорий и БЖУ (ИИ-калькулятор)"
      description="Пересчитай дневную цель с помощью ИИ или скорректируй макронутриенты вручную."
    >
      <AiTargetsConfigurator
        targets={targets}
        latestWeightKg={latestWeightKg}
        compact
        onSaved={() => onOpenChange(false)}
      />
    </ResponsiveModal>
  );
}

// ============================================================================
// 3. Recipe Create / Edit Modal (With Live Auto-Calculated КБЖУ From Ingredients!)
// ============================================================================

interface RecipeFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: RecipeWithIngredients | null;
}

export function RecipeFormModal({
  open,
  onOpenChange,
  recipe,
}: RecipeFormModalProps) {
  const [pending, startTransition] = React.useTransition();

  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState<MealCategory>("dinner");
  const [servings, setServings] = React.useState("2");
  const [cookMinutes, setCookMinutes] = React.useState("25");
  const [isFavorite, setIsFavorite] = React.useState(false);
  const [steps, setSteps] = React.useState("");
  const [tagsText, setTagsText] = React.useState("");
  const [ingredients, setIngredients] = React.useState<RecipeIngredientDraft[]>(
    []
  );
  const [lookupLoadingIdx, setLookupLoadingIdx] = React.useState<number | null>(
    null
  );

  React.useEffect(() => {
    if (!open) return;
    if (recipe) {
      setTitle(recipe.title);
      setCategory((recipe.meal_category as MealCategory) ?? "dinner");
      setServings(String(recipe.default_servings ?? 2));
      setCookMinutes(
        recipe.cook_time_minutes ? String(recipe.cook_time_minutes) : ""
      );
      setIsFavorite(Boolean(recipe.is_favorite));
      setSteps(recipe.steps_markdown ?? "");
      setTagsText((recipe.tags ?? []).join(", "));
      setIngredients(
        recipe.ingredients.length > 0
          ? recipe.ingredients.map((i) => ({
              display_name: i.display_name,
              ingredient_key: i.ingredient_key,
              amount: Number(i.amount),
              unit: i.unit as IngredientUnit,
              aisle_group: i.aisle_group || "Прочее",
              is_optional: i.is_optional,
              grams_equivalent:
                i.grams_equivalent !== null ? Number(i.grams_equivalent) : null,
              kcal_100g: i.kcal_100g !== null ? Number(i.kcal_100g) : null,
              protein_100g:
                i.protein_100g !== null ? Number(i.protein_100g) : null,
              fat_100g: i.fat_100g !== null ? Number(i.fat_100g) : null,
              carbs_100g: i.carbs_100g !== null ? Number(i.carbs_100g) : null,
            }))
          : [
              {
                display_name: "",
                amount: 100,
                unit: "g",
                aisle_group: "Прочее",
              },
            ]
      );
    } else {
      setTitle("");
      setCategory("dinner");
      setServings("2");
      setCookMinutes("25");
      setIsFavorite(false);
      setSteps("");
      setTagsText("");
      setIngredients([
        {
          display_name: "Куриная грудка сырая",
          amount: 300,
          unit: "g",
          aisle_group: "Мясо, птица и рыба",
          kcal_100g: 113,
          protein_100g: 23.6,
          fat_100g: 1.9,
          carbs_100g: 0,
        },
        {
          display_name: "Рис басмати сухой",
          amount: 120,
          unit: "g",
          aisle_group: "Бакалея и крупы",
          kcal_100g: 350,
          protein_100g: 7.5,
          fat_100g: 0.8,
          carbs_100g: 77.5,
        },
      ]);
    }
  }, [open, recipe]);

  function updateIng(idx: number, patch: Partial<RecipeIngredientDraft>) {
    setIngredients((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  }

  async function autoLookupIngredientRow(idx: number, rawName: string) {
    const clean = rawName.trim();
    if (clean.length < 2) return;
    setLookupLoadingIdx(idx);
    try {
      const found = await searchFoodAutoLookupAction(clean, {
        allowRemote: true,
        limit: 1,
      });
      const best = found[0];
      if (best) {
        setIngredients((prev) =>
          prev.map((row, i) =>
            i === idx
              ? {
                  ...row,
                  kcal_100g: Number(best.kcal_100g),
                  protein_100g: Number(best.protein_100g),
                  fat_100g: Number(best.fat_100g),
                  carbs_100g: Number(best.carbs_100g),
                }
              : row
          )
        );
      }
    } catch {
      // Server will still compute on save
    } finally {
      setLookupLoadingIdx((curr) => (curr === idx ? null : curr));
    }
  }

  // Live Auto-Calculated Summary across all ingredient rows!
  const liveRecipeSummary = React.useMemo(() => {
    const servCount = Math.max(1, Number(servings) || 1);
    let totalW = 0;
    let totalKcal = 0;
    let totalP = 0;
    let totalF = 0;
    let totalC = 0;

    for (const ing of ingredients) {
      if (!ing.display_name.trim() || Number(ing.amount) <= 0 || ing.is_optional) {
        continue;
      }
      const g = estimateGramsFromUnit(Number(ing.amount), String(ing.unit ?? "g"));
      totalW += g;
      const ratio = g / 100;
      totalKcal += Number(ing.kcal_100g ?? 0) * ratio;
      totalP += Number(ing.protein_100g ?? 0) * ratio;
      totalF += Number(ing.fat_100g ?? 0) * ratio;
      totalC += Number(ing.carbs_100g ?? 0) * ratio;
    }

    return {
      totalWeightG: Math.round(totalW),
      totalKcal: Math.round(totalKcal),
      totalP: round1(totalP),
      totalF: round1(totalF),
      totalC: round1(totalC),
      perServingKcal: Math.round(totalKcal / servCount),
      perServingP: round1(totalP / servCount),
      perServingF: round1(totalF / servCount),
      perServingC: round1(totalC / servCount),
      per100gKcal: totalW > 0 ? Math.round((totalKcal / totalW) * 100) : 0,
    };
  }, [ingredients, servings]);

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
          ingredients: ingredients.filter(
            (i) => i.display_name.trim() && Number(i.amount) > 0
          ),
        });
        toast.success(
          recipe
            ? "Рецепт и его КБЖУ пересчитаны"
            : "Рецепт добавлен с авто-расчётом КБЖУ"
        );
        onOpenChange(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Не удалось сохранить рецепт"
        );
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={recipe ? "Редактировать рецепт" : "Новый рецепт с авто-КБЖУ"}
      description="КБЖУ каждого ингредиента подтягивается автоматически, а калорийность порции считается сама."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="rec-title">Название блюда</FieldLabel>
            <Input
              id="rec-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Запеканка из творога 5% с голубикой"
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
              <FieldLabel htmlFor="rec-serv">Порций в рецепте</FieldLabel>
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
              Избранный рецепт
            </FieldLabel>
            <Switch
              id="rec-fav"
              checked={isFavorite}
              onCheckedChange={setIsFavorite}
            />
          </Field>

          <Separator />

          {/* Dynamic Auto-Macro Ingredients */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Ингредиенты (на {servings || 2} порц.)
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  setIngredients((prev) => [
                    ...prev,
                    {
                      display_name: "",
                      amount: 100,
                      unit: "g",
                      aisle_group: "Овощи и зелень",
                    },
                  ])
                }
                className="rounded-lg"
              >
                <PlusIcon data-icon="inline-start" />
                Ингредиент
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {ingredients.map((ing, idx) => {
                const rowGrams = estimateGramsFromUnit(
                  Number(ing.amount),
                  String(ing.unit ?? "g")
                );
                const rowKcal =
                  ing.kcal_100g !== null && ing.kcal_100g !== undefined
                    ? Math.round((Number(ing.kcal_100g) * rowGrams) / 100)
                    : null;

                return (
                  <div
                    key={idx}
                    className="flex flex-col gap-1.5 rounded-xl border border-border/75 bg-muted/25 p-2.5"
                  >
                    <div className="grid grid-cols-12 items-center gap-1.5">
                      <Input
                        value={ing.display_name}
                        onChange={(e) =>
                          updateIng(idx, {
                            display_name: e.target.value,
                            kcal_100g: null,
                          })
                        }
                        onBlur={(e) =>
                          void autoLookupIngredientRow(idx, e.target.value)
                        }
                        placeholder="Продукт (напр. Овсянка или Молоко 2.5%)"
                        className="col-span-12 min-h-9 sm:col-span-5"
                      />
                      <Input
                        type="number"
                        min={0.1}
                        step="any"
                        value={String(ing.amount)}
                        onChange={(e) =>
                          updateIng(idx, {
                            amount: Number(e.target.value) || 0,
                          })
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
                          onValueChange={(v) =>
                            updateIng(idx, { aisle_group: v })
                          }
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
                          onClick={() =>
                            setIngredients((prev) =>
                              prev.length <= 1
                                ? prev
                                : prev.filter((_, i) => i !== idx)
                            )
                          }
                          aria-label="Убрать ингредиент"
                        >
                          <Trash2Icon className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground num-tabular">
                      <span>
                        {lookupLoadingIdx === idx
                          ? "Подтягиваем КБЖУ…"
                          : ing.kcal_100g !== null && ing.kcal_100g !== undefined
                            ? `${ing.kcal_100g} ккал/100г (Б ${ing.protein_100g ?? 0} · Ж ${ing.fat_100g ?? 0} · У ${ing.carbs_100g ?? 0})`
                            : "Укажи продукт — КБЖУ подтянется автоматически"}
                      </span>
                      {rowKcal !== null ? (
                        <span className="font-medium text-foreground">
                          ~{rowGrams} г = {rowKcal} ккал
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Calculated Recipe Macro Summary Box */}
          <div className="grid grid-cols-1 gap-2 rounded-2xl border border-primary/25 bg-accent/55 p-3.5 text-xs sm:grid-cols-3 num-tabular">
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">Весь рецепт</span>
              <span className="text-sm font-semibold">
                {liveRecipeSummary.totalKcal} ккал · ~{liveRecipeSummary.totalWeightG} г
              </span>
              <span className="text-[11px] text-muted-foreground">
                Б {liveRecipeSummary.totalP} · Ж {liveRecipeSummary.totalF} · У{" "}
                {liveRecipeSummary.totalC}
              </span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">
                На 1 порцию (÷ {servings || 1})
              </span>
              <span className="text-sm font-semibold text-primary">
                {liveRecipeSummary.perServingKcal} ккал
              </span>
              <span className="text-[11px] text-muted-foreground">
                Б {liveRecipeSummary.perServingP} · Ж {liveRecipeSummary.perServingF} · У{" "}
                {liveRecipeSummary.perServingC}
              </span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">На 100 г блюда</span>
              <span className="text-sm font-semibold">
                {liveRecipeSummary.per100gKcal} ккал
              </span>
              <span className="text-[11px] text-muted-foreground">
                Авто-расчёт по составу
              </span>
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor="rec-steps">Шаги приготовления</FieldLabel>
            <Textarea
              id="rec-steps"
              rows={3}
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder="Короткий алгоритм приготовления…"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="rec-tags">Теги (через запятую)</FieldLabel>
            <Input
              id="rec-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="белок, завтрак, впрок"
              className="min-h-10"
            />
          </Field>
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
                Пересчитываем и сохраняем…
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
// 4. Body Weight Log Modal
// ============================================================================

interface WeightLogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string;
  editingWeight?: BodyWeightLog | null;
  latestWeightKg?: number | null;
  onSaved?: () => void;
}

export function WeightLogModal({
  open,
  onOpenChange,
  defaultDate,
  editingWeight = null,
  latestWeightKg = null,
  onSaved,
}: WeightLogModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [loggedDate, setLoggedDate] = React.useState(defaultDate);
  const [weightKg, setWeightKg] = React.useState("");
  const [bodyFat, setBodyFat] = React.useState("");
  const [waistCm, setWaistCm] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (editingWeight) {
      setLoggedDate(editingWeight.logged_date);
      setWeightKg(String(editingWeight.weight_kg));
      setBodyFat(
        editingWeight.body_fat_pct !== null
          ? String(editingWeight.body_fat_pct)
          : ""
      );
      setWaistCm(
        editingWeight.waist_cm !== null ? String(editingWeight.waist_cm) : ""
      );
      setNote(editingWeight.note ?? "");
    } else {
      setLoggedDate(defaultDate);
      setWeightKg(latestWeightKg ? String(latestWeightKg) : "");
      setBodyFat("");
      setWaistCm("");
      setNote("");
    }
  }, [open, defaultDate, editingWeight, latestWeightKg]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveBodyWeightAction({
          logged_date: loggedDate,
          weight_kg: Number(weightKg),
          body_fat_pct: bodyFat ? Number(bodyFat) : null,
          waist_cm: waistCm ? Number(waistCm) : null,
          note,
        });
        toast.success("Замер веса сохранён");
        onSaved?.();
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения веса");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={editingWeight ? "Изменить замер веса" : "Внести вес тела"}
      description="Динамика веса сопоставляется со средним потреблением калорий и БЖУ."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="bw-kg">Вес (кг)</FieldLabel>
              <Input
                id="bw-kg"
                type="number"
                min={25}
                max={300}
                step="0.1"
                placeholder="81.4"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                required
                className="min-h-11 text-base font-semibold num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="bw-date">Дата замера</FieldLabel>
              <Input
                id="bw-date"
                type="date"
                value={loggedDate}
                onChange={(e) => setLoggedDate(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="bw-fat">Доля жира (%, опц.)</FieldLabel>
              <Input
                id="bw-fat"
                type="number"
                min={3}
                max={65}
                step="0.1"
                value={bodyFat}
                onChange={(e) => setBodyFat(e.target.value)}
                placeholder="16.5"
                className="min-h-10 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="bw-waist">Талия (см, опц.)</FieldLabel>
              <Input
                id="bw-waist"
                type="number"
                min={40}
                max={180}
                step="0.5"
                value={waistCm}
                onChange={(e) => setWaistCm(e.target.value)}
                placeholder="82"
                className="min-h-10 num-tabular"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="bw-note">Заметка</FieldLabel>
            <Input
              id="bw-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Натощак утром"
              className="min-h-10"
            />
          </Field>
        </FieldGroup>

        <div className="flex items-center justify-between gap-2 pt-2">
          {editingWeight ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteBodyWeightAction(editingWeight.id);
                  toast("Замер удалён");
                  onSaved?.();
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
            Сохранить вес
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 5. Meal Plan & Pantry Modals (Preserved & Polished)
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
  const [sourceMode, setSourceMode] = React.useState<"recipe" | "custom">(
    "recipe"
  );
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
          recipe_id:
            sourceMode === "recipe" && recipeId ? Number(recipeId) : null,
          custom_meal_title: sourceMode === "custom" ? customTitle : null,
          planned_servings: Number(servings) || 1,
          status: entry?.status as
            | "planned"
            | "cooked"
            | "eaten"
            | "skipped"
            | undefined,
        });
        toast.success(
          entry ? "Запись в меню обновлена" : "Блюдо поставлено в меню недели"
        );
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
      title={entry ? "Изменить блюдо в меню" : "Поставить блюдо в меню недели"}
      description="План меню помогает заранее собрать список покупок за вычетом домашних запасов."
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
                        {r.title} ({r.kcal_per_serving ?? 0} ккал)
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
                placeholder="Например: Доставка поке с лососем"
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
        item.low_stock_threshold !== null &&
          item.low_stock_threshold !== undefined
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
        toast.success(
          item ? "Запас обновлён" : "Продукт добавлен в запасы дома"
        );
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
