import { requireOwnerSession } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function GoalsStagePreviewPage() {
  await requireOwnerSession();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Цели и привычки</h1>
          <p className="text-sm text-muted-foreground">
            Таблицы целей, связи с задачами и 1-тап трекера привычек развёрнуты в Supabase
          </p>
        </div>
        <Badge variant="secondary">Этап 4</Badge>
      </div>
      <Card className="rounded-2xl shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Модуль подготовлен в БД</CardTitle>
          <CardDescription>
            На Этапе 4 здесь откроется дерево целей с прогрессом по реальным действиям и быстрые трекеры привычек в один тап.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
