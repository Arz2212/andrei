"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutGridIcon,
  CheckSquareIcon,
  BookHeartIcon,
  SlidersHorizontalIcon,
  WalletIcon,
  HeartPulseIcon,
  UtensilsIcon,
  TargetIcon,
  PlusIcon,
  SunIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  LogOutIcon,
} from "lucide-react";
import { cn, formatDateLongRu } from "@/lib/utils";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { signOutAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { QuickCaptureDrawer } from "@/components/shell/quick-capture-drawer";

interface AppShellProps {
  children: React.ReactNode;
  todayDate: string;
  displayName: string;
  waitingCount: number;
  pendingActionsCount: number;
}

const PRIMARY_NAV = [
  { href: "/", label: "Главная", mobileLabel: "Сегодня", icon: LayoutGridIcon },
  { href: "/tasks", label: "Задачи и слоты", mobileLabel: "Дела", icon: CheckSquareIcon },
  { href: "/journal", label: "Состояние и дневник", mobileLabel: "Дневник", icon: BookHeartIcon },
  { href: "/settings", label: "ИИ и настройки", mobileLabel: "Настройки", icon: SlidersHorizontalIcon },
] as const;

const MODULE_NAV = [
  { href: "/finance", label: "Финансы", stage: "Этап 2", icon: WalletIcon },
  { href: "/health", label: "Здоровье", stage: "Этап 3", icon: HeartPulseIcon },
  { href: "/nutrition", label: "Питание", stage: "Этап 3", icon: UtensilsIcon },
  { href: "/goals", label: "Цели и привычки", stage: "Этап 4", icon: TargetIcon },
] as const;

export function AppShell({
  children,
  todayDate,
  displayName,
  waitingCount,
  pendingActionsCount,
}: AppShellProps) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [quickOpen, setQuickOpen] = React.useState(false);
  const isRealtimeConnected = useRealtimeRefresh();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const formattedToday = React.useMemo(() => formatDateLongRu(todayDate), [todayDate]);

  return (
    <div className="flex min-h-dvh w-full bg-background text-foreground">
      {/* Desktop Sidebar (>= 1024px) */}
      <aside
        className={cn(
          "hidden lg:flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          collapsed ? "w-[72px]" : "w-[252px]"
        )}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground font-semibold">
              L
            </div>
            {!collapsed ? (
              <div className="flex flex-col truncate">
                <span className="truncate text-sm font-semibold tracking-tight">
                  Life OS
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {displayName}
                </span>
              </div>
            ) : null}
          </Link>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          >
            {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </Button>
        </div>

        <div className="px-3 pb-3">
          <Button
            type="button"
            onClick={() => setQuickOpen(true)}
            className={cn(
              "w-full rounded-xl",
              collapsed ? "px-0 justify-center" : "justify-start"
            )}
          >
            <PlusIcon data-icon="inline-start" />
            {!collapsed ? "Быстрая запись" : null}
          </Button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-1">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-10 items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  collapsed && "justify-center px-0"
                )}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="size-4 shrink-0" />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
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

          <div className="my-3">
            <Separator />
          </div>

          {!collapsed ? (
            <span className="px-3 pb-1 text-xs font-medium text-muted-foreground">
              Разделы системы
            </span>
          ) : null}

          {MODULE_NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-9 items-center justify-between rounded-xl px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  collapsed && "justify-center px-0"
                )}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="size-4 shrink-0" />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
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

        <div className="flex flex-col gap-2 border-t border-sidebar-border p-3">
          {!collapsed ? (
            <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
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

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className={cn("flex-1 rounded-xl", collapsed && "px-0")}
              aria-label="Переключить тему"
            >
              {mounted && resolvedTheme === "dark" ? (
                <SunIcon data-icon="inline-start" />
              ) : (
                <MoonIcon data-icon="inline-start" />
              )}
              {!collapsed ? (
                <span>{mounted && resolvedTheme === "dark" ? "Светлая" : "Тёмная"}</span>
              ) : null}
            </Button>

            <form action={signOutAction}>
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
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
        <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-xl safe-top">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 lg:h-16 lg:px-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold text-sm lg:hidden">
                L
              </div>
              <div className="flex flex-col min-w-0">
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

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 rounded-xl lg:size-9"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                aria-label="Переключить тему"
              >
                {mounted && resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
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
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/85 backdrop-blur-xl lg:hidden pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2 py-1.5">
          {PRIMARY_NAV.slice(0, 2).map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
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

          {PRIMARY_NAV.slice(2).map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
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
        </div>
      </nav>

      <QuickCaptureDrawer
        open={quickOpen}
        onOpenChange={setQuickOpen}
        todayDate={todayDate}
      />
    </div>
  );
}
