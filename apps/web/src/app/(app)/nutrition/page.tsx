import { requireOwnerSession } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function NutritionStagePreviewPage() {
  await requireOwnerSession();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Питание и список покупок</h1>
          <p className="text-sm text-muted-foreground">
            Таблицы рецептов, плана готовки, домашних запасов и изолятор Open Food Facts уже созданы в БД
          </p>
        </div>
        <Badge variant="secondary">Этап 3</Badge>
      </div>
      <Card className="rounded-2xl shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Модуль подготовлен в БД</CardTitle>
          <CardDescription>
            На Этапе 3 здесь запустится библиотека рецептов, конструктор меню по порциям, учёт запасов дома и авто-список покупок (плюс проверка Open Food Facts за фича-флагом).
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
