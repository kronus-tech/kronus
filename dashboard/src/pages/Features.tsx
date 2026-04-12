import { Badge } from "../components/Badge";
import { agents, mcpConnections, skillCount, activePersona } from "../data/features";
import { Bot, Plug, Zap, User } from "lucide-react";

const tierColors = {
  orchestration: "accent" as const,
  specialist: "info" as const,
  analysis: "warning" as const,
  content: "success" as const,
};

const statusVariant = {
  active: "success" as const,
  idle: "muted" as const,
  disabled: "error" as const,
};

const mcpStatusVariant = {
  connected: "success" as const,
  degraded: "warning" as const,
  disconnected: "error" as const,
};

export function Features() {
  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-app-surface border border-app-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center">
            <Bot size={20} className="text-accent" />
          </div>
          <div>
            <span className="text-xl font-mono font-semibold text-app-text">{agents.length}</span>
            <p className="text-[11px] text-app-text-muted">Agents</p>
          </div>
        </div>
        <div className="bg-app-surface border border-app-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-info)]/15 flex items-center justify-center">
            <Zap size={20} className="text-[var(--color-info)]" />
          </div>
          <div>
            <span className="text-xl font-mono font-semibold text-app-text">{skillCount}</span>
            <p className="text-[11px] text-app-text-muted">Skills</p>
          </div>
        </div>
        <div className="bg-app-surface border border-app-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-success)]/15 flex items-center justify-center">
            <Plug size={20} className="text-[var(--color-success)]" />
          </div>
          <div>
            <span className="text-xl font-mono font-semibold text-app-text">
              {mcpConnections.length}
            </span>
            <p className="text-[11px] text-app-text-muted">MCP Servers</p>
          </div>
        </div>
        <div className="bg-app-surface border border-app-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-warning)]/15 flex items-center justify-center">
            <User size={20} className="text-[var(--color-warning)]" />
          </div>
          <div>
            <span className="text-sm font-mono font-semibold text-app-text">{activePersona}</span>
            <p className="text-[11px] text-app-text-muted">Active Persona</p>
          </div>
        </div>
      </div>

      {/* Agents grid */}
      <div className="space-y-3">
        <h2 className="text-[15px] font-medium text-app-text">Agents</h2>
        <div className="grid grid-cols-2 gap-3">
          {agents.map((agent) => (
            <div
              key={agent.name}
              className="bg-app-surface border border-app-border rounded-xl p-4 flex items-center gap-4 hover:border-app-border-hover transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-app-card flex items-center justify-center">
                <Bot size={16} className="text-app-text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-mono font-medium text-app-text">
                    {agent.name}
                  </span>
                  <Badge variant={tierColors[agent.tier]}>{agent.tier}</Badge>
                </div>
                <p className="text-[11px] text-app-text-muted mt-0.5 truncate">
                  {agent.description}
                </p>
              </div>
              <Badge variant={statusVariant[agent.status]} dot>
                {agent.status}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* MCP connections */}
      <div className="space-y-3">
        <h2 className="text-[15px] font-medium text-app-text">MCP Connections</h2>
        <div className="grid grid-cols-3 gap-3">
          {mcpConnections.map((mcp) => (
            <div
              key={mcp.name}
              className="bg-app-surface border border-app-border rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Plug size={14} className="text-app-text-muted" />
                <span className="text-[13px] font-mono text-app-text">{mcp.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-app-text-faint">{mcp.latency}</span>
                <Badge variant={mcpStatusVariant[mcp.status]} dot>
                  {mcp.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
