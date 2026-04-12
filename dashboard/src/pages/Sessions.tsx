import { Badge } from "../components/Badge";
import { sessions } from "../data/sessions";

const statusVariant = {
  running: "success" as const,
  completed: "muted" as const,
  failed: "error" as const,
  paused: "warning" as const,
};

export function Sessions() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium text-app-text">Active & Recent Sessions</h2>
        <span className="text-[12px] font-mono text-app-text-muted">
          {sessions.filter((s) => s.status === "running").length} running
        </span>
      </div>

      <div className="bg-app-surface border border-app-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-app-border">
              {["ID", "Project", "Status", "Model", "Agent", "Duration", "Tokens", "Cost"].map(
                (h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-[11px] font-medium text-app-text-muted uppercase tracking-wider"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr
                key={s.id}
                className="border-b border-app-border last:border-0 hover:bg-app-hover transition-colors"
              >
                <td className="px-4 py-3 font-mono text-[12px] text-accent">{s.id}</td>
                <td className="px-4 py-3 text-[12px] text-app-text font-medium">{s.project}</td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant[s.status]} dot>
                    {s.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-app-text-secondary">
                  {s.model}
                </td>
                <td className="px-4 py-3 text-[12px] text-app-text-secondary">{s.agent}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-app-text-muted">
                  {s.duration}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-app-text-muted">
                  {s.tokens}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-app-text">{s.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
