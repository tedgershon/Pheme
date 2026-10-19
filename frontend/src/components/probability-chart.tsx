"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Bet, MarketOption, PricePoint } from "@/lib/types";

const OPTION_COLORS = [
  "var(--chart-1, hsl(12, 76%, 61%))",
  "var(--chart-2, hsl(173, 58%, 39%))",
  "var(--chart-3, hsl(197, 37%, 24%))",
  "var(--chart-4, hsl(43, 74%, 66%))",
  "var(--chart-5, hsl(27, 87%, 67%))",
  "hsl(262, 60%, 55%)",
  "hsl(330, 65%, 55%)",
  "hsl(150, 50%, 45%)",
  "hsl(200, 70%, 50%)",
  "hsl(60, 60%, 45%)",
];

function formatDate(timestamp: string) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ProbabilityChart({ data }: { data: PricePoint[] }) {
  return (
    // minHeight/minWidth silences the recharts "-1" warning that fires on the
    // first render before ResizeObserver measures the parent
    <ResponsiveContainer
      width="100%"
      height="100%"
      minHeight={200}
      minWidth={0}
    >
      <AreaChart data={data} margin={{ top: 5, right: 40, bottom: 5, left: 5 }}>
        <defs>
          <linearGradient id="probGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--success)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis dataKey="timestamp" hide />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          orientation="right"
          width={35}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "13px",
          }}
          labelFormatter={(label) => formatDate(String(label))}
          formatter={(value) => [`${value}%`, "Probability"]}
        />
        <Area
          type="linear"
          dataKey="probability"
          stroke="var(--success)"
          strokeWidth={2}
          fill="url(#probGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function getOptionColor(index: number): string {
  return OPTION_COLORS[index % OPTION_COLORS.length];
}

interface MultiOptionDataPoint {
  timestamp: string;
  [optionId: string]: number | string;
}

export function buildMultiOptionPriceHistory(
  options: MarketOption[],
  bets: Bet[],
): MultiOptionDataPoint[] {
  if (bets.length === 0) return [];

  const sorted = [...bets].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const pools: Record<string, number> = {};
  for (const opt of options) {
    pools[opt.id] = 0;
  }

  const points: MultiOptionDataPoint[] = [];

  for (const bet of sorted) {
    if (!bet.option_id) continue;
    pools[bet.option_id] = (pools[bet.option_id] || 0) + bet.amount;
    const totalPool = Object.values(pools).reduce((s, v) => s + v, 0);

    const point: MultiOptionDataPoint = { timestamp: bet.created_at };
    for (const opt of options) {
      point[opt.id] =
        totalPool > 0 ? Math.round((pools[opt.id] / totalPool) * 100) : 0;
    }
    points.push(point);
  }

  return points;
}

export function MultiProbabilityChart({
  options,
  data,
  visibleOptionIds,
}: {
  options: MarketOption[];
  data: MultiOptionDataPoint[];
  visibleOptionIds: string[];
}) {
  const optionMap = new Map(options.map((o) => [o.id, o]));

  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minHeight={200}
      minWidth={0}
    >
      <LineChart data={data} margin={{ top: 5, right: 40, bottom: 5, left: 5 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis dataKey="timestamp" hide />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          orientation="right"
          width={35}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "13px",
          }}
          labelFormatter={(label) => formatDate(String(label))}
          formatter={(value, name) => [
            `${Number(value)}%`,
            optionMap.get(String(name))?.label ?? String(name),
          ]}
        />
        <Legend
          formatter={(value: string) => optionMap.get(value)?.label ?? value}
        />
        {options.map((opt, idx) => {
          if (!visibleOptionIds.includes(opt.id)) return null;
          return (
            <Line
              key={opt.id}
              type="linear"
              dataKey={opt.id}
              stroke={getOptionColor(idx)}
              strokeWidth={2}
              dot={false}
              name={opt.id}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
