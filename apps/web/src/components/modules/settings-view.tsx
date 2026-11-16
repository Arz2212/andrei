"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  SparklesIcon,
  PlusIcon,
  Trash2Icon,
  LogOutIcon,
  Loader2Icon,
  MessageSquareIcon,
} from "lucide-react";
import type {
  AssistantAgreement,
  AssistantSettings,
  UserProfile,
} from "@life-os/db";
import {
  createAgreementAction,
  deleteAgreementAction,
  saveAssistantSettingsAction,
  saveOwnerProfileSettingsAction,
  signOutAction,
  toggleAgreementAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SCOPE_LABELS: Record<string, string> = {
  general: "Общее",
  planning: "Планирование",
  finance: "Финансы",
  health: "Здоровье",
  nutrition: "Питание",
  communication: "Общение",
};

interface SettingsViewProps {
  profile: UserProfile | null;
  assistantSettings: AssistantSettings | null;
  agreements: AssistantAgreement[];
}

export function SettingsView({
  profile,
  assistantSettings,
  agreements,
}: SettingsViewProps) {
  const [pending, startTransition] = React.useTransition();

  // Assistant Persona state
  const [personaName, setPersonaName] = React.useState(
    assistantSettings?.persona_name ?? "Напарник"
  );
  const [systemPrompt, setSystemPrompt] = React.useState(
    assistantSettings?.system_prompt ?? ""
  );
  const [toneGuidelines, setToneGuidelines] = React.useState(
    assistantSettings?.tone_guidelines ?? ""
  );
  const [morningTime, setMorningTime] = React.useState(
    (assistantSettings?.morning_digest_time ?? "08:30").slice(0, 5)
  );
  const [eveningTime, setEveningTime] = React.useState(
    (assistantSettings?.evening_review_time ?? "21:30").slice(0, 5)
  );
  const [proactiveEnabled, setProactiveEnabled] = React.useState(
    assistantSettings?.proactive_reminders_enabled ?? true
  );

  // Agreements state
  const [newRuleScope, setNewRuleScope] = React.useState<
    "general" | "planning" | "finance" | "health" | "nutrition" | "communication"
  >("planning");
  const [newRuleText, setNewRuleText] = React.useState("");

  // System & Telegram Topics state
  const flags = (profile?.feature_flags ?? {}) as Record<string, unknown>;
  const topicMap = (profile?.telegram_topic_map ?? {}) as Record<string, number>;

  const [displayName, setDisplayName] = React.useState(
    profile?.display_name ?? "Андрей"
  );
  const [dailyBuffer, setDailyBuffer] = React.useState(
    String(profile?.daily_buffer_minutes ?? 90)
  );
  const [availMinutes, setAvailMinutes] = React.useState(
    String(profile?.default_available_minutes ?? 480)
  );
  const [forumChatId, setForumChatId] = React.useState(
    profile?.telegram_forum_chat_id ? String(profile.telegram_forum_chat_id) : ""
  );
  const [topicAssistant, setTopicAssistant] = React.useState(
    topicMap.assistant ? String(topicMap.assistant) : ""
  );
  const [topicFinance, setTopicFinance] = React.useState(
    topicMap.finance ? String(topicMap.finance) : ""
  );
  const [topicNutrition, setTopicNutrition] = React.useState(
    topicMap.nutrition ? String(topicMap.nutrition) : ""
  );
  const [topicHealth, setTopicHealth] = React.useState(
    topicMap.health ? String(topicMap.health) : ""
  );
  const [topicJournal, setTopicJournal] = React.useState(
    topicMap.journal ? String(topicMap.journal) : ""
  );
  const [enableCaloriesOff, setEnableCaloriesOff] = React.useState(
    Boolean(flags.enable_calories_off)
  );

  function handleSavePersona(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveAssistantSettingsAction({
          persona_name: personaName,
          system_prompt: systemPrompt,
          tone_guidelines: toneGuidelines,
          morning_digest_time: morningTime,
          evening_review_time: eveningTime,
          proactive_reminders_enabled: proactiveEnabled,
        });
        toast.success("Промпт и характер ИИ обновлены на лету");
      } catch {
        toast.error("Не удалось сохранить настройки ИИ");
      }
    });
  }

  function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createAgreementAction({
          scope: newRuleScope,
          rule_text: newRuleText,
        });
        setNewRuleText("");
        toast.success("Договорённость добавлена");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  function handleSaveSystem(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const nextTopics: Record<string, number> = {};
        if (Number(topicAssistant)) nextTopics.assistant = Number(topicAssistant);
        if (Number(topicFinance)) nextTopics.finance = Number(topicFinance);
        if (Number(topicNutrition)) nextTopics.nutrition = Number(topicNutrition);
        if (Number(topicHealth)) nextTopics.health = Number(topicHealth);
        if (Number(topicJournal)) nextTopics.journal = Number(topicJournal);

        await saveOwnerProfileSettingsAction({
          display_name: displayName,
          daily_buffer_minutes: Number(dailyBuffer) || 90,
          default_available_minutes: Number(availMinutes) || 480,
          telegram_forum_chat_id: forumChatId ? Number(forumChatId) : null,
          telegram_topic_map: nextTopics,
          enable_calories_off: enableCaloriesOff,
        });
        toast.success("Системные настройки сохранены");
      } catch {
        toast.error("Не удалось обновить системные настройки");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            ИИ-ассистент и настройки
          </h1>
          <p className="text-sm text-muted-foreground">
            Редактируй системный промпт, личные договорённости и параметры Telegram на лету
          </p>
        </div>

        <form action={signOutAction} className="lg:hidden">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="min-h-10 rounded-xl"
          >
            <LogOutIcon data-icon="inline-start" />
            Выйти
          </Button>
        </form>
      </div>

      <Tabs defaultValue="persona" className="flex flex-col gap-4">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-11 w-full justify-start sm:w-auto rounded-xl">
            <TabsTrigger value="persona" className="min-h-9 px-4">
              <SparklesIcon className="mr-1.5 size-4" />
              Личность ИИ
            </TabsTrigger>
            <TabsTrigger value="agreements" className="min-h-9 px-4">
              Договорённости ({agreements.length})
            </TabsTrigger>
            <TabsTrigger value="system" className="min-h-9 px-4">
              <MessageSquareIcon className="mr-1.5 size-4" />
              Telegram и модули
            </TabsTrigger>
          </TabsList>
        </div>

        {/* PERSONA & SYSTEM PROMPT */}
        <TabsContent value="persona">
          <Card className="rounded-2xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Характер и системный промпт бизнес-ассистента
              </CardTitle>
              <CardDescription>
                Бот подгружает эти инструкции при каждом диалоге в Telegram без перезапуска сервера
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSavePersona} className="flex flex-col gap-4">
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="ai-name">Имя / роль ассистента</FieldLabel>
                    <Input
                      id="ai-name"
                      value={personaName}
                      onChange={(e) => setPersonaName(e.target.value)}
                      className="min-h-11 max-w-md"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-prompt">Системный промпт личности</FieldLabel>
                    <Textarea
                      id="ai-prompt"
                      rows={8}
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      className="font-mono text-xs leading-relaxed"
                    />
                    <FieldDescription>
                      Определяет, как ассистент разбирает завалы, фильтрует идеи от команд и предлагает слоты.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="ai-tone">Тон общения и границы</FieldLabel>
                    <Textarea
                      id="ai-tone"
                      rows={3}
                      value={toneGuidelines}
                      onChange={(e) => setToneGuidelines(e.target.value)}
                    />
                  </Field>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor="ai-morning">Утренний фокус</FieldLabel>
                      <Input
                        id="ai-morning"
                        type="time"
                        value={morningTime}
                        onChange={(e) => setMorningTime(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="ai-evening">Вечерний итог</FieldLabel>
                      <Input
                        id="ai-evening"
                        type="time"
                        value={eveningTime}
                        onChange={(e) => setEveningTime(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                    <Field orientation="horizontal" className="items-center justify-between rounded-xl border border-border px-3.5 py-2.5 sm:mt-6">
                      <FieldLabel htmlFor="ai-proactive" className="font-normal">
                        Напоминания бота
                      </FieldLabel>
                      <Switch
                        id="ai-proactive"
                        checked={proactiveEnabled}
                        onCheckedChange={setProactiveEnabled}
                      />
                    </Field>
                  </div>
                </FieldGroup>

                <Button
                  type="submit"
                  disabled={pending}
                  className="min-h-11 w-full sm:w-fit sm:px-8 rounded-xl"
                >
                  {pending ? (
                    <>
                      <Loader2Icon data-icon="inline-start" className="animate-spin" />
                      Сохраняем…
                    </>
                  ) : (
                    "Сохранить настройки ИИ"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PERSONAL AGREEMENTS / RULES */}
        <TabsContent value="agreements" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-5 rounded-2xl shadow-none h-fit">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Новое правило или договорённость
              </CardTitle>
              <CardDescription>
                Ассистент учитывает этот список при распределении дел и разборе голосовых
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddRule} className="flex flex-col gap-4">
                <FieldGroup className="gap-3.5">
                  <Field>
                    <FieldLabel>Сфера действия</FieldLabel>
                    <Select
                      value={newRuleScope}
                      onValueChange={(v) =>
                        setNewRuleScope(
                          v as
                            | "general"
                            | "planning"
                            | "finance"
                            | "health"
                            | "nutrition"
                            | "communication"
                        )
                      }
                    >
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="planning">Планирование и слоты</SelectItem>
                          <SelectItem value="finance">Финансы и компенсации</SelectItem>
                          <SelectItem value="health">Здоровье и тренировки</SelectItem>
                          <SelectItem value="nutrition">Питание и покупки</SelectItem>
                          <SelectItem value="communication">Общение и тон</SelectItem>
                          <SelectItem value="general">Общее правило</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="rule-input">Формулировка договорённости</FieldLabel>
                    <Textarea
                      id="rule-input"
                      rows={3}
                      value={newRuleText}
                      onChange={(e) => setNewRuleText(e.target.value)}
                      placeholder="Например: В пятницу после 16:00 не ставить созвоны, оставлять вечер под итоги недели"
                      required
                    />
                  </Field>
                </FieldGroup>

                <Button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl">
                  <PlusIcon data-icon="inline-start" />
                  Добавить в память ИИ
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-7 rounded-2xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Активные правила владельца
              </CardTitle>
              <CardDescription>
                Можно временно выключить любое правило без удаления
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {agreements.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  Список договорённостей пока пуст.
                </p>
              ) : (
                agreements.map((ag) => (
                  <div
                    key={ag.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border/80 p-3.5"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Switch
                        checked={ag.is_active}
                        onCheckedChange={(checked) =>
                          startTransition(async () => {
                            await toggleAgreementAction(ag.id, checked);
                          })
                        }
                        aria-label="Переключить правило"
                        className="mt-0.5"
                      />
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {SCOPE_LABELS[ag.scope] ?? ag.scope}
                          </Badge>
                          {ag.source === "telegram_confirmed" ? (
                            <span className="text-xs text-muted-foreground">
                              из Telegram
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm leading-relaxed">{ag.rule_text}</p>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        startTransition(async () => {
                          await deleteAgreementAction(ag.id);
                          toast("Правило удалено");
                        })
                      }
                      aria-label="Удалить правило"
                    >
                      <Trash2Icon className="text-muted-foreground" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SYSTEM, TELEGRAM TOPICS & FEATURE FLAGS */}
        <TabsContent value="system">
          <Card className="rounded-2xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Параметры дня, Топики Telegram и модули
              </CardTitle>
              <CardDescription>
                Привязка личного Telegram ID ({profile?.telegram_user_id ?? 1479912341}) и приватной супергруппы с Топиками
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveSystem} className="flex flex-col gap-5">
                <FieldGroup className="gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor="sys-name">Имя в системе</FieldLabel>
                      <Input
                        id="sys-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="min-h-11"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sys-avail">Рабочее окно по умолчанию (мин)</FieldLabel>
                      <Input
                        id="sys-avail"
                        type="number"
                        min={60}
                        max={960}
                        step={30}
                        value={availMinutes}
                        onChange={(e) => setAvailMinutes(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sys-buf">Буфер дня по умолчанию (мин)</FieldLabel>
                      <Input
                        id="sys-buf"
                        type="number"
                        min={0}
                        max={360}
                        step={15}
                        value={dailyBuffer}
                        onChange={(e) => setDailyBuffer(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                  </div>

                  <Separator />

                  <Field>
                    <FieldLabel htmlFor="tg-group">
                      ID приватной супергруппы Telegram с Топиками (опционально)
                    </FieldLabel>
                    <Input
                      id="tg-group"
                      placeholder="-1001234567890"
                      value={forumChatId}
                      onChange={(e) => setForumChatId(e.target.value)}
                      className="min-h-11 max-w-md font-mono text-sm"
                    />
                    <FieldDescription>
                      Бот работает и в личном чате, и в супергруппе с разделением по Темам (message_thread_id).
                    </FieldDescription>
                  </Field>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <Field>
                      <FieldLabel htmlFor="t-ass">Топик Ассистент</FieldLabel>
                      <Input
                        id="t-ass"
                        placeholder="2"
                        value={topicAssistant}
                        onChange={(e) => setTopicAssistant(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="t-fin">Топик Финансы</FieldLabel>
                      <Input
                        id="t-fin"
                        placeholder="4"
                        value={topicFinance}
                        onChange={(e) => setTopicFinance(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="t-nut">Топик Питание</FieldLabel>
                      <Input
                        id="t-nut"
                        placeholder="6"
                        value={topicNutrition}
                        onChange={(e) => setTopicNutrition(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="t-hea">Топик Здоровье</FieldLabel>
                      <Input
                        id="t-hea"
                        placeholder="8"
                        value={topicHealth}
                        onChange={(e) => setTopicHealth(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="t-jou">Топик Дневник</FieldLabel>
                      <Input
                        id="t-jou"
                        placeholder="10"
                        value={topicJournal}
                        onChange={(e) => setTopicJournal(e.target.value)}
                        className="min-h-11 num-tabular"
                      />
                    </Field>
                  </div>

                  <Separator />

                  <Field
                    orientation="horizontal"
                    className="items-center justify-between rounded-xl border border-border p-4"
                  >
                    <div className="flex flex-col gap-0.5 pr-4">
                      <FieldLabel htmlFor="flag-off">
                        Учёт калорий и сканер штрихкодов (Open Food Facts)
                      </FieldLabel>
                      <FieldDescription>
                        Опциональный блок за фича-флагом (Этап 3). Отключение не влияет на планировщик меню и покупок.
                      </FieldDescription>
                    </div>
                    <Switch
                      id="flag-off"
                      checked={enableCaloriesOff}
                      onCheckedChange={setEnableCaloriesOff}
                    />
                  </Field>
                </FieldGroup>

                <Button
                  type="submit"
                  disabled={pending}
                  className="min-h-11 w-full sm:w-fit sm:px-8 rounded-xl"
                >
                  Сохранить системные параметры
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
