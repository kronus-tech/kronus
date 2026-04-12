import { ExternalLink } from "lucide-react";

export function KnowledgeGraph() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium text-app-text">Knowledge Graph</h2>
        <a
          href="http://localhost:4242"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hover transition-colors"
        >
          Open in Brain UI
          <ExternalLink size={12} />
        </a>
      </div>

      <div className="bg-app-surface border border-app-border rounded-xl overflow-hidden">
        <div className="h-[calc(100vh-200px)] min-h-[500px]">
          <iframe
            src="http://localhost:4242"
            className="w-full h-full border-0"
            title="Kronus Knowledge Graph"
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-app-surface border border-app-border rounded-xl p-4 text-center">
          <span className="text-2xl font-mono font-semibold text-app-text">147</span>
          <p className="text-[11px] text-app-text-muted mt-1">Total Nodes</p>
        </div>
        <div className="bg-app-surface border border-app-border rounded-xl p-4 text-center">
          <span className="text-2xl font-mono font-semibold text-app-text">312</span>
          <p className="text-[11px] text-app-text-muted mt-1">Connections</p>
        </div>
        <div className="bg-app-surface border border-app-border rounded-xl p-4 text-center">
          <span className="text-2xl font-mono font-semibold text-app-text">4</span>
          <p className="text-[11px] text-app-text-muted mt-1">Projects</p>
        </div>
        <div className="bg-app-surface border border-app-border rounded-xl p-4 text-center">
          <span className="text-2xl font-mono font-semibold text-accent">92%</span>
          <p className="text-[11px] text-app-text-muted mt-1">Health Score</p>
        </div>
      </div>
    </div>
  );
}
