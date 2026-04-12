import { cn } from "../lib/cn";
import { logs } from "../data/logs";

const levelColors = {
  info: "text-[var(--color-info)]",
  warn: "text-[var(--color-warning)]",
  error: "text-[var(--color-danger)]",
  debug: "text-app-text-muted",
};

const levelBg = {
  info: "bg-[var(--color-info)]/10",
  warn: "bg-[var(--color-warning)]/10",
  error: "bg-[var(--color-danger)]/10",
  debug: "bg-app-hover",
};

export function Logs() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium text-app-text">System Logs</h2>
        <div className="flex items-center gap-2">
          {(["info", "warn", "error", "debug"] as const).map((level) => (
            <button
              key={level}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-mono font-medium transition-colors",
                levelBg[level],
                levelColors[level]
              )}
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-app-surface border border-app-border rounded-xl overflow-hidden font-mono text-[12px]">
        {logs.map((log, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-4 px-4 py-2.5 border-b border-app-border last:border-0",
              log.level === "error" && "bg-[var(--color-danger)]/5"
            )}
          >
            <span className="text-app-text-faint w-[70px] shrink-0">{log.timestamp}</span>
            <span
              className={cn(
                "w-[48px] shrink-0 font-medium uppercase text-[11px]",
                levelColors[log.level]
              )}
            >
              {log.level}
            </span>
            <span className="text-accent w-[90px] shrink-0">{log.source}</span>
            <span className="text-app-text-secondary flex-1">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
