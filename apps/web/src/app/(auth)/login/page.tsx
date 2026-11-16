"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheckIcon, Loader2Icon } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const supabase = getBrowserSupabase();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError || !data.user) {
        setError("Неверный email или пароль. Доступ открыт только владельцу системы.");
        setPending(false);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("Не удалось выполнить вход. Проверь соединение и попробуй снова.");
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 safe-top safe-bottom">
      <div className="w-full max-w-[400px] flex flex-col gap-6">
        <div className="flex items-center gap-3 px-1">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-semibold text-lg">
            L
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight">Life OS</span>
            <span className="text-xs text-muted-foreground">
              Персональная система жизни
            </span>
          </div>
        </div>

        <Card className="rounded-2xl border-border/90 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold tracking-tight">
              Вход владельца
            </CardTitle>
            <CardDescription>
              Приватный контур синхронизации с Telegram-ассистентом.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="login-email">Электронная почта</FieldLabel>
                  <Input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="min-h-11"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="login-password">Пароль</FieldLabel>
                  <Input
                    id="login-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Введите пароль"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="min-h-11"
                  />
                </Field>
              </FieldGroup>

              <Button
                type="submit"
                disabled={pending}
                className="min-h-11 w-full rounded-xl"
              >
                {pending ? (
                  <>
                    <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    Проверяем доступ…
                  </>
                ) : (
                  <>
                    <ShieldCheckIcon data-icon="inline-start" />
                    Войти в систему
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="px-2 text-center text-xs text-muted-foreground">
          Защищено Supabase Auth · Индексация поисковиками отключена
        </p>
      </div>
    </div>
  );
}
