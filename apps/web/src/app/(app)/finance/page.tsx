import { getFinanceBalanceSummary } from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { formatRub } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function FinanceStagePreviewPage() {
  const { db } = await requireOwnerSession();
  const summary = await getFinanceBalanceSummary(db);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Финансы</h1>
          <p className="text-sm text-muted-foreground">
            База данных, таблицы счетов, подписок и представления Safe-to-Spend уже развёрнуты
          </p>
        </div>
        <Badge variant="secondary">Полный UI — Этап 2</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="rounded-2xl shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Доступно для трат (Safe-to-Spend)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold num-tabular">
            {formatRub(Number(summary?.safe_to_spend ?? 0))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Общий баланс по счетам
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold num-tabular">
            {formatRub(Number(summary?.total_balance ?? 0))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ожидаю компенсаций
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold num-tabular">
            {formatRub(Number(summary?.pending_reimbursements ?? 0))}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Готовность контура к Этапу 2
          </CardTitle>
          <CardDescription>
            Через Telegram-бота уже работают превью-карточки записи трат с подтверждением. На Этапе 2 здесь откроется полный интерфейс счетов, подписок, кредиток, компенсаций и аналитики.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
