import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-[color:var(--border)] bg-[color:var(--bg-secondary)] text-[color:var(--text)]",
        secondary:
          "border-[color:color-mix(in_srgb,var(--notice)_24%,var(--border))] bg-[color:color-mix(in_srgb,var(--notice)_10%,var(--bg))] text-[color:var(--text)]",
        outline:
          "border-[color:var(--border)] bg-transparent text-[color:var(--text-secondary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
