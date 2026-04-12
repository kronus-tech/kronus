import { Activity, DollarSign, Shield, BrainCircuit } from "lucide-react";
import { cn } from "../lib/cn";

const icons = {
  activity: Activity,
  dollar: DollarSign,
  shield: Shield,
  brain: BrainCircuit,
};

interface StatCardProps {
  label: string;
  value: string;
  delta: string;
  deltaType: "up" | "down" | "neutral";
  icon: keyof typeof icons;
}

export function StatCard({ label, value, delta, deltaType, icon }: StatCardProps) {
  const Icon = icons[icon];

  return (
    <div className="bg-app-surface border border-app-border rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-app-text-muted uppercase tracking-wider">
          {label}
        </span>
        <div className="w-8 h-8 rounded-lg bg-accent-subtle flex items-center justify-center">
          <Icon size={16} className="text-accent" />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-semibold text-app-text font-mono">{value}</span>
        {delta && (
          <span
            className={cn(
              "text-[11px] font-mono font-medium pb-0.5",
              deltaType === "up" && "text-[var(--color-success)]",
              deltaType === "down" && "text-[var(--color-success)]",
              deltaType === "neutral" && "text-app-text-muted"
            )}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
