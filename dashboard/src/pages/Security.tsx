import { Badge } from "../components/Badge";
import { securityEvents } from "../data/security";
import { Shield, Check, X, Clock } from "lucide-react";

const statusConfig = {
  approved: { variant: "success" as const, icon: Check, label: "Approved" },
  denied: { variant: "error" as const, icon: X, label: "Denied" },
  pending: { variant: "warning" as const, icon: Clock, label: "Pending" },
};

const actionColors = {
  read: "text-[var(--color-info)]",
  write: "text-[var(--color-warning)]",
  execute: "text-accent",
  delete: "text-[var(--color-danger)]",
};

export function Security() {
  const pending = securityEvents.filter((e) => e.status === "pending");
  const history = securityEvents.filter((e) => e.status !== "pending");

  return (
    <div className="space-y-6">
      {/* Pending approvals */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[15px] font-medium text-app-text flex items-center gap-2">
            <Shield size={16} className="text-[var(--color-warning)]" />
            Pending Approvals
            <span className="text-[12px] font-mono text-[var(--color-warning)] bg-[var(--color-warning)]/15 px-2 py-0.5 rounded-full">
              {pending.length}
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {pending.map((event) => (
              <div
                key={event.id}
                className="bg-app-surface border-2 border-[var(--color-warning)]/30 rounded-xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[12px] text-app-text-muted">Agent</span>
                    <p className="text-[14px] font-medium text-app-text font-mono">
                      {event.agent}
                    </p>
                  </div>
                  <Badge variant="warning" dot>
                    {event.action.toUpperCase()}
                  </Badge>
                </div>
                <div className="bg-app-card rounded-lg px-3 py-2">
                  <code className="text-[12px] font-mono text-accent break-all">{event.path}</code>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[var(--color-success)] text-white rounded-lg text-[12px] font-medium hover:opacity-90 transition-opacity">
                    <Check size={14} />
                    Approve
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[var(--color-danger)] text-white rounded-lg text-[12px] font-medium hover:opacity-90 transition-opacity">
                    <X size={14} />
                    Deny
                  </button>
                </div>
                <span className="text-[10px] font-mono text-app-text-faint">{event.timestamp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit trail */}
      <div className="space-y-3">
        <h2 className="text-[15px] font-medium text-app-text">Scope Guard Audit Trail</h2>
        <div className="bg-app-surface border border-app-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-app-border">
                {["Time", "Agent", "Action", "Path", "Status", "Approved By"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-[11px] font-medium text-app-text-muted uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((event) => {
                const cfg = statusConfig[event.status];
                return (
                  <tr
                    key={event.id}
                    className="border-b border-app-border last:border-0 hover:bg-app-hover transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[11px] text-app-text-muted">
                      {event.timestamp}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-app-text">
                      {event.agent}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-[11px] font-medium ${actionColors[event.action]}`}>
                        {event.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-accent max-w-[300px] truncate">
                      {event.path}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={cfg.variant} dot>
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-app-text-muted">
                      {event.approvedBy || event.reason || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
