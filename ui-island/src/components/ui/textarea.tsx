import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 text-sm leading-6 text-[color:var(--text)] shadow-none outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[color:var(--text-tertiary)] focus-visible:border-[color:var(--focus-border)] focus-visible:ring-2 focus-visible:ring-[color:var(--focus-border)]/18 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
