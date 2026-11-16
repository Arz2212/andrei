import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMinutesRu(totalMinutes: number | null | undefined): string {
  if (!totalMinutes || totalMinutes <= 0) return "0 мин";
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins} мин`;
  if (mins === 0) return `${hours} ч`;
  return `${hours} ч ${mins} м`;
}

export function formatRub(amount: number | null | undefined): string {
  const num = Number(amount ?? 0);
  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(num)} ₽`;
}

export function formatDateLongRu(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  const formatted = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function formatDateShortRu(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const d = isoDate.includes("T") ? new Date(isoDate) : new Date(`${isoDate}T12:00:00`);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(d);
}
