import { StatCard } from "../components/StatCard";
import { Badge } from "../components/Badge";
import { stats, activityFeed, costChart } from "../data/overview";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

export function Overview() {
  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Cost chart */}
        <div className="col-span-2 bg-app-surface border border-app-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-medium text-app-text">Cost — Last 7 Days</h3>
            <span className="text-[12px] font-mono text-app-text-muted">$5.47 total</span>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={costChart}>
                <defs>
                  <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "var(--color-app-text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-app-text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v}`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-app-card)",
                    border: "1px solid var(--color-app-border)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--color-app-text)",
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
                />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  fill="url(#costGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Activity feed */}
        <div className="bg-app-surface border border-app-border rounded-xl p-5">
          <h3 className="text-[13px] font-medium text-app-text mb-4">Activity</h3>
          <div className="space-y-3">
            {activityFeed.slice(0, 7).map((item, i) => (
              <div key={i} className="flex gap-3 items-start">
                <Badge variant={item.type} dot>
                  {item.type}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-app-text-secondary leading-relaxed truncate">
                    {item.event}
                  </p>
                  <span className="text-[10px] text-app-text-muted font-mono">{item.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
