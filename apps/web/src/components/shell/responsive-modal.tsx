"use client";

import * as React from "react";
import { useIsMobile } from "@/hooks/use-media-query";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Enforces SPEC.md §5 & scrollable modal safety on short laptop screens:
 * - On iPhone / Mobile (<768px): ALWAYS opens as a Vaul bottom-sheet Drawer with internal scroll.
 * - On Desktop (>=768px): opens as a max-h-[calc(100dvh-2rem)] flex-col Dialog with sticky header and scrollable body.
 */
export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: ResponsiveModalProps) {
  const isMobile = useIsMobile(768);

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="flex max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DrawerHeader className="shrink-0 px-0 pb-2.5 text-left">
            <DrawerTitle className="text-lg font-semibold tracking-tight">
              {title}
            </DrawerTitle>
            {description ? (
              <DrawerDescription>{description}</DrawerDescription>
            ) : null}
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1 pb-2">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[540px]">
        <DialogHeader className="shrink-0 border-b border-border/60 px-6 pt-5 pb-3.5 pr-12">
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
