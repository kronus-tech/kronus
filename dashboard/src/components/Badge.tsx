import { cn } from "../lib/cn";

type Variant = "success" | "warning" | "error" | "info" | "accent" | "muted";

const variantStyles: Record<Variant, string> = {
  success: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  error: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  info: "bg-[var(--color-info)]/15 text-[var(--color-info)]",
  accent: "bg-accent-subtle text-accent",
  muted: "bg-app-hover text-app-text-muted",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: Variant;
  dot?: boolean;
}

export function Badge({ children, variant = "muted", dot }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium",
        variantStyles[variant]
      )}
    >
      {dot && (
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            variant === "success" && "bg-[var(--color-success)]",
            variant === "warning" && "bg-[var(--color-warning)]",
            variant === "error" && "bg-[var(--color-danger)]",
            variant === "info" && "bg-[var(--color-info)]",
            variant === "accent" && "bg-accent",
            variant === "muted" && "bg-app-text-muted"
          )}
        />
      )}
      {children}
    </span>
  );
}
