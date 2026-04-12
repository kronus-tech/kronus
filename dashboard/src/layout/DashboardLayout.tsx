import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { Bell, Search } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/sessions": "Sessions",
  "/knowledge-graph": "Knowledge Graph",
  "/logs": "Logs",
  "/todos": "Todos",
  "/security": "Security",
  "/features": "Features",
};

export function DashboardLayout() {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "Dashboard";

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 ml-[240px] flex flex-col">
        {/* Top bar */}
        <header className="h-14 border-b border-app-border flex items-center justify-between px-6 bg-app-bg sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="text-app-text-muted text-[12px] font-mono">dashboard</span>
            <span className="text-app-text-faint text-[12px]">/</span>
            <span className="text-app-text text-[13px] font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            <button className="p-2 rounded-lg hover:bg-app-hover transition-colors">
              <Search size={16} className="text-app-text-muted" />
            </button>
            <div className="relative">
              <button className="p-2 rounded-lg hover:bg-app-hover transition-colors">
                <Bell size={16} className="text-app-text-muted" />
              </button>
              <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-accent rounded-full" />
            </div>
            <ThemeToggle />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
