import Image from "next/image";
import { cn } from "cn";

/** The ADR Reporter mark: a halftone sparkle in the brand orange (#e24704). Decorative beside the product name. */
export function LogoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <Image
      src="/brand/logo-mark.svg"
      alt=""
      aria-hidden
      width={size}
      height={size}
      priority
      className={cn("shrink-0", className)}
    />
  );
}
