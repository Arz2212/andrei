"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BookHeartIcon,
  CalendarRangeIcon,
  CheckSquareIcon,
  CompassIcon,
  HeartPulseIcon,
  LayoutGridIcon,
  LogOutIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SunIcon,
  TargetIcon,
  UtensilsIcon,
  WalletIcon,
} from "lucide-react";
import type { FinanceAccount, FinanceCategory } from "@life-os/db";
import { cn, formatDateLongRu } from "@/lib/utils";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { signOutAction } from "@/app/actions";
import { BrandLogo } from "@/components/shell/brand-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { QuickCaptureDrawer } from "@/components/shell/quick-capture-drawer";

interface AppShellProps {
  children: React.ReactNode;
  todayDate: string;
  displayName: string;
  waitingCount: number;
  pendingActionsCount: number;
  financeAccounts: FinanceAccount[];
  financeCategories: FinanceCategory[];
}

const PRIMARY_NAV = [
  { href: "/", label: "Главная", mobileLabel: "Сегодня", icon: LayoutGridIcon },
  {
    href: "/tasks",
    label: "Задачи и слоты",
    mobileLabel: "Дела",
    icon: CheckSquareIcon,
  },
  {
    href: "/tasks?tab=week",
    label: "Календарь недели",
    mobileLabel: "Календарь",
    icon: CalendarRangeIcon,
  },
  {
    href: "/finance",
    label: "Финансы",
    mobileLabel: "Деньги",
    icon: WalletIcon,
  },
  {
    href: "/nutrition",
    label: "Питание и покупки",
    mobileLabel: "Питание",
    icon: UtensilsIcon,
  },
  {
    href: "/health",
    label: "Здоровье и тренировки",
    mobileLabel: "Здоровье",
    icon: HeartPulseIcon,
  },
  {
    href: "/journal",
    label: "Состояние и дневник",
    mobileLabel: "Дневник",
    icon: BookHeartIcon,
  },
] as const;

const MOBILE_BOTTOM_LEFT = [PRIMARY_NAV[0], PRIMARY_NAV[1]] as const;
const MOBILE_HUB_ITEMS = [
  {
    href: "/nutrition",
    title: "Питание и покупки",
    subtitle: "Меню недели, рецепты, запасы дома и покупки",
    icon: UtensilsIcon,
  },
  {
    href: "/health",
    title: "Здоровье и тренировки",
    subtitle: "Плавающие окна, программы, медкарта и PDF",
    icon: HeartPulseIcon,
  },
  {
    href: "/journal",
    title: "Состояние и дневник",
    subtitle: "Пульс энергии 1–10 и вечерняя оценка дня",
    icon: BookHeartIcon,
  },
  {
    href: "/tasks?tab=week",
    title: "Календарь недели",
    subtitle: "7-дневная сетка встреч и задач по часам",
    icon: CalendarRangeIcon,
  },
  {
    href: "/goals",
    title: "Цели и привычки",
    subtitle: "Этап 4 · ориентиры и ежедневные трекеры",
    icon: TargetIcon,
  },
  {
    href: "/settings",
    title: "ИИ и настройки",
    subtitle: "Характер напарника, правила и сводки",
    icon: SlidersHorizontalIcon,
  },
] as const;

const MODULE_NAV = [
  { href: "/goals", label: "Цели и привычки", stage: "Этап 4", icon: TargetIcon },
] as const;

export function AppShell({
  children,
  todayDate,
  displayName,
  waitingCount,
  pendingActionsCount,
  financeAccounts,
  financeCategories,
}: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [hubOpen, setHubOpen] = React.useState(false);
  const isRealtimeConnected = useRealtimeRefresh();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const formattedToday = React.useMemo(
    () => formatDateLongRu(todayDate),
    [todayDate]
  );

  function isPrimaryActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/tasks?tab=week") {
      return pathname === "/tasks" && currentTab === "week";
    }
    if (href === "/tasks") {
      return pathname === "/tasks" && currentTab !== "week";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const isWeekCalendarActive = pathname === "/tasks" && currentTab === "week";
  const isSettingsActive =
    pathname === "/settings" || pathname.startsWith("/settings/");
  const isFinanceActive = isPrimaryActive("/finance");
  const isHubSectionActive =
    pathname.startsWith("/nutrition") ||
    pathname.startsWith("/health") ||
    pathname.startsWith("/journal") ||
    pathname.startsWith("/goals") ||
    isSettingsActive;

  return (
    <div className="flex min-h-dvh w-full bg-background text-foreground">
      {/* Desktop Sidebar (>= 1024px) */}
      <aside
        className={cn(
          "hidden lg:sticky lg:top-0 lg:flex lg:h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          collapsed ? "w-[68px]" : "w-[252px]"
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center",
            collapsed ? "justify-center px-2" : "justify-between px-4"
          )}
        >
          {!collapsed ? (
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <BrandLogo size="md" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold tracking-tight">
                  Life OS
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {displayName}
                </span>
              </div>
            </Link>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size={collapsed ? "icon" : "icon-sm"}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            title={collapsed ? "Развернуть меню" : "Свернуть меню"}
            className={cn(collapsed && "size-10 rounded-xl")}
          >
            {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </Button>
        </div>

        <div
          className={cn(
            "pb-3",
            collapsed ? "flex justify-center px-2" : "px-3"
          )}
        >
          {collapsed ? (
            <Button
              type="button"
              size="icon"
              onClick={() => setQuickOpen(true)}
              aria-label="Быстрая запись"
              title="Быстрая запись"
              className="size-10 rounded-xl"
            >
              <PlusIcon />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => setQuickOpen(true)}
              className="w-full justify-start rounded-xl"
            >
              <PlusIcon data-icon="inline-start" />
              Быстрая запись
            </Button>
          )}
        </div>

        <nav
          className={cn(
            "flex flex-1 flex-col gap-1 overflow-y-auto py-1",
            collapsed ? "items-center px-2" : "px-3"
          )}
        >
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = isPrimaryActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-xl text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  collapsed
                    ? "size-10 justify-center p-0"
                    : "min-h-10 w-full justify-between px-3 py-2"
                )}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="size-4 shrink-0" />
                  {!collapsed ? (
                    <span className="truncate">{item.label}</span>
                  ) : null}
                </span>
                {!collapsed && item.href === "/tasks" && waitingCount > 0 ? (
                  <Badge variant="secondary" className="num-tabular">
                    {waitingCount}
                  </Badge>
                ) : null}
                {!collapsed && item.href === "/" && pendingActionsCount > 0 ? (
                  <Badge className="num-tabular">{pendingActionsCount}</Badge>
                ) : null}
              </Link>
            );
          })}

          <div className={cn("my-3", collapsed ? "w-8" : "w-full")}>
            <Separator />
          </div>

          {!collapsed ? (
            <span className="px-3 pb-1 text-xs font-medium text-muted-foreground">
              Следующий этап
            </span>
          ) : null}

          {MODULE_NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? `${item.label} (${item.stage})` : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-xl text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  collapsed
                    ? "size-10 justify-center p-0"
                    : "min-h-9 w-full justify-between px-3 py-1.5"
                )}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="size-4 shrink-0" />
                  {!collapsed ? (
                    <span className="truncate">{item.label}</span>
                  ) : null}
                </span>
                {!collapsed ? (
                  <span className="text-[11px] text-muted-foreground num-tabular">
                    {item.stage}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Footer: Settings at very bottom + Sync + Theme + Logout */}
        <div
          className={cn(
            "flex shrink-0 flex-col gap-2 border-t border-sidebar-border p-3",
            collapsed && "items-center px-2"
          )}
        >
          <Link
            href="/settings"
            title={collapsed ? "ИИ и настройки" : undefined}
            aria-label={collapsed ? "ИИ и настройки" : undefined}
            className={cn(
              "flex items-center rounded-xl text-sm font-medium transition-colors",
              isSettingsActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              collapsed
                ? "size-10 justify-center p-0"
                : "min-h-10 w-full justify-start gap-2.5 px-3 py-2"
            )}
          >
            <SlidersHorizontalIcon className="size-4 shrink-0" />
            {!collapsed ? <span className="truncate">ИИ и настройки</span> : null}
          </Link>

          {!collapsed ? (
            <div className="flex items-center justify-between px-2 py-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    isRealtimeConnected ? "bg-primary" : "bg-warning"
                  )}
                />
                {isRealtimeConnected ? "Синхронизация активна" : "Подключение…"}
              </span>
            </div>
          ) : null}

          <div
            className={cn(
              "flex items-center",
              collapsed ? "flex-col gap-1.5" : "w-full gap-1"
            )}
          >
            {collapsed ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                className="size-10 rounded-xl"
                aria-label="Переключить тему"
                title={
                  mounted && resolvedTheme === "dark"
                    ? "Светлая тема"
                    : "Тёмная тема"
                }
              >
                {mounted && resolvedTheme === "dark" ? (
                  <SunIcon />
                ) : (
                  <MoonIcon />
                )}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                className="flex-1 rounded-xl"
                aria-label="Переключить тему"
              >
                {mounted && resolvedTheme === "dark" ? (
                  <SunIcon data-icon="inline-start" />
                ) : (
                  <MoonIcon data-icon="inline-start" />
                )}
                <span>
                  {mounted && resolvedTheme === "dark" ? "Светлая" : "Тёмная"}
                </span>
              </Button>
            )}

            <form action={signOutAction}>
              <Button
                type="submit"
                variant="ghost"
                size={collapsed ? "icon" : "icon-sm"}
                className={cn(collapsed && "size-10 rounded-xl")}
                aria-label="Выйти из системы"
                title="Выйти"
              >
                <LogOutIcon />
              </Button>
            </form>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-md safe-top">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-2 px-4 lg:h-16 lg:px-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <Link href="/" className="lg:hidden">
                <BrandLogo size="sm" />
              </Link>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold tracking-tight lg:text-base">
                  {formattedToday}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground lg:hidden">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      isRealtimeConnected ? "bg-primary" : "bg-warning"
                    )}
                  />
                  Life OS · Live
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                asChild
                variant={isWeekCalendarActive ? "secondary" : "ghost"}
                size="icon"
                className="size-11 rounded-xl lg:hidden"
              >
                <Link href="/tasks?tab=week" aria-label="Календарь недели">
                  <CalendarRangeIcon />
                </Link>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 rounded-xl lg:size-9"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                aria-label="Переключить тему"
              >
                {mounted && resolvedTheme === "dark" ? (
                  <SunIcon />
                ) : (
                  <MoonIcon />
                )}
              </Button>

              <Button
                asChild
                variant={isSettingsActive ? "secondary" : "ghost"}
                size="icon"
                className="size-11 rounded-xl lg:hidden"
              >
                <Link href="/settings" aria-label="ИИ и настройки">
                  <SlidersHorizontalIcon />
                </Link>
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={() => setQuickOpen(true)}
                className="hidden lg:inline-flex rounded-xl"
              >
                <PlusIcon data-icon="inline-start" />
                Быстрое действие
              </Button>
            </div>
          </div>
        </header>

        {/* Page Container */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] lg:px-8 lg:py-7">
          {children}
        </main>
      </div>

      {/* Mobile / iPhone Frosted Bottom Tabbar (< 1024px) */}
      <nav
        aria-label="Нижняя навигация"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/90 backdrop-blur-xl lg:hidden pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2 py-1.5">
          {MOBILE_BOTTOM_LEFT.map((item) => {
            const Icon = item.icon;
            const active = isPrimaryActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="size-5" />
                <span className="truncate">{item.mobileLabel}</span>
              </Link>
            );
          })}

          <div className="flex items-center justify-center">
            <Button
              type="button"
              onClick={() => setQuickOpen(true)}
              aria-label="Быстрое действие"
              className="size-12 rounded-2xl shadow-sm"
            >
              <PlusIcon className="size-5" />
            </Button>
          </div>

          <Link
            href="/finance"
            className={cn(
              "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium transition-colors",
              isFinanceActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <WalletIcon className="size-5" />
            <span className="truncate">Деньги</span>
          </Link>

          <button
            type="button"
            onClick={() => setHubOpen(true)}
            className={cn(
              "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium transition-colors",
              isHubSectionActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <CompassIcon className="size-5" />
            <span className="truncate">Разделы</span>
          </button>
        </div>
      </nav>

      {/* Mobile Sections Hub Drawer (Vaul) */}
      <Drawer open={hubOpen} onOpenChange={setHubOpen}>
        <DrawerContent className="mx-auto max-h-[85dvh] w-full max-w-lg rounded-t-2xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <DrawerHeader className="px-0 text-left">
            <DrawerTitle className="text-lg font-semibold tracking-tight">
              Разделы Life OS
            </DrawerTitle>
            <DrawerDescription>
              Быстрый переход ко всем сферам жизни и настройкам
            </DrawerDescription>
          </DrawerHeader>

          <div className="grid grid-cols-1 gap-2 overflow-y-auto pb-2">
            {MOBILE_HUB_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isPrimaryActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setHubOpen(false)}
                  className={cn(
                    "flex min-h-14 items-center gap-3.5 rounded-2xl border p-3.5 transition-colors",
                    active
                      ? "border-primary/40 bg-accent/65 text-foreground"
                      : "border-border/80 bg-card hover:bg-muted/50"
                  )}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Icon className="size-5" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold">
                      {item.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.subtitle}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>

      <QuickCaptureDrawer
        open={quickOpen}
        onOpenChange={setQuickOpen}
        todayDate={todayDate}
        financeAccounts={financeAccounts}
        financeCategories={financeCategories}
      />
    </div>
  );
}
