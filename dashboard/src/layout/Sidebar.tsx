import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Activity,
  BrainCircuit,
  Terminal,
  CheckSquare,
  Shield,
  Puzzle,
} from "lucide-react";
import { cn } from "../lib/cn";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/sessions", icon: Activity, label: "Sessions" },
  { to: "/knowledge-graph", icon: BrainCircuit, label: "Knowledge Graph" },
  { to: "/logs", icon: Terminal, label: "Logs" },
  { to: "/todos", icon: CheckSquare, label: "Todos" },
  { to: "/security", icon: Shield, label: "Security" },
  { to: "/features", icon: Puzzle, label: "Features" },
];

export function Sidebar() {
  return (
    <aside className="w-[240px] h-screen bg-sidebar-bg border-r border-app-border flex flex-col fixed left-0 top-0">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-app-border">
        <img src="/kronus-logo.svg" alt="Kronus" className="w-7 h-7" />
        <span className="font-mono font-semibold text-sm text-app-text tracking-tight">
          kronus
        </span>
        <span className="text-[10px] font-mono text-accent bg-accent-subtle px-1.5 py-0.5 rounded ml-auto">
          v5.5
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-3 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-sidebar-active text-accent border-l-2 border-accent"
                  : "text-app-text-muted hover:text-app-text-secondary hover:bg-app-hover border-l-2 border-transparent"
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-app-border flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-accent-subtle flex items-center justify-center text-accent text-[11px] font-mono font-bold">
          PK
        </div>
        <div className="flex flex-col">
          <span className="text-[12px] font-medium text-app-text-secondary">kronus</span>
          <span className="text-[10px] text-app-text-muted font-mono">local</span>
        </div>
      </div>
    </aside>
  );
}
