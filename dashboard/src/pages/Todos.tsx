import { Badge } from "../components/Badge";
import { todos } from "../data/todos";
import { cn } from "../lib/cn";
import { CheckSquare, Square } from "lucide-react";

const priorityVariant = {
  high: "error" as const,
  medium: "warning" as const,
  low: "info" as const,
};

export function Todos() {
  const grouped = todos.reduce(
    (acc, todo) => {
      if (!acc[todo.project]) acc[todo.project] = [];
      acc[todo.project].push(todo);
      return acc;
    },
    {} as Record<string, typeof todos>
  );

  const doneCount = todos.filter((t) => t.done).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium text-app-text">Extracted Todos</h2>
        <span className="text-[12px] font-mono text-app-text-muted">
          {doneCount}/{todos.length} completed
        </span>
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([project, items]) => (
          <div
            key={project}
            className="bg-app-surface border border-app-border rounded-xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-app-border flex items-center gap-2">
              <span className="text-[13px] font-medium text-app-text">{project}</span>
              <span className="text-[11px] font-mono text-app-text-muted">
                {items.filter((t) => !t.done).length} open
              </span>
            </div>
            <div className="divide-y divide-app-border">
              {items.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-app-hover transition-colors"
                >
                  {todo.done ? (
                    <CheckSquare
                      size={16}
                      className="text-[var(--color-success)] shrink-0"
                    />
                  ) : (
                    <Square size={16} className="text-app-text-muted shrink-0" />
                  )}
                  <span
                    className={cn(
                      "text-[13px] flex-1",
                      todo.done
                        ? "text-app-text-muted line-through"
                        : "text-app-text"
                    )}
                  >
                    {todo.text}
                  </span>
                  <Badge variant={priorityVariant[todo.priority]}>{todo.priority}</Badge>
                  <span className="text-[10px] font-mono text-app-text-faint">{todo.source}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
