import { requireOwnerSession } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function HealthStagePreviewPage() {
  await requireOwnerSession();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Здоровье и тренировки</h1>
          <p className="text-sm text-muted-foreground">
            Таблицы программ тренировок, плавающих окон, врачей и приватный бакет меддокументов развёрнуты в Supabase
          </p>
        </div>
        <Badge variant="secondary">Этап 3</Badge>
      </div>
      <Card className="rounded-2xl shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Модуль подготовлен в БД</CardTitle>
          <CardDescription>
            На Этапе 3 здесь включится планировщик тренировок с плавающими окнами и картотека визитов к врачам, анализов и PDF-заключений.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
