import * as React from "react";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Intentional geometric Life OS emblem:
 * Rounded Botanical Spruce tile with an asymmetric 3-block Bento grid
 * and a focus compass spark in the top-right quadrant.
 */
export function BrandLogo({ className, size = "md" }: BrandLogoProps) {
  const sizeClass =
    size === "sm"
      ? "size-8 rounded-lg"
      : size === "lg"
        ? "size-11 rounded-2xl"
        : "size-9 rounded-xl";

  const svgSize = size === "sm" ? 18 : size === "lg" ? 24 : 20;

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-primary text-primary-foreground shadow-2xs",
        sizeClass,
        className
      )}
      aria-hidden="true"
    >
      <svg
        width={svgSize}
        height={svgSize}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Left vertical pillar (Core Focus) */}
        <rect
          x="3.5"
          y="3.5"
          width="7.5"
          height="17"
          rx="2.4"
          fill="currentColor"
        />
        {/* Bottom-right block (Foundation / Balance) */}
        <rect
          x="13"
          y="12.5"
          width="7.5"
          height="8"
          rx="2.4"
          fill="currentColor"
          fillOpacity="0.82"
        />
        {/* Top-right compass star / pulse node */}
        <path
          d="M16.75 3.25L18.1 6.4L21.25 7.75L18.1 9.1L16.75 12.25L15.4 9.1L12.25 7.75L15.4 6.4L16.75 3.25Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}
