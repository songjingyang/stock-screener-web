/**
 * 迷你 SVG 走势图（sparkline）
 *
 * 设计取舍（KISS / YAGNI）：
 *   - 纯 SVG，无第三方依赖；上百行同时渲染时性能远好于 lightweight-charts
 *   - 颜色由「区间起点 → 终点」涨跌决定（绿涨 / 红跌）
 *   - 末端高亮一个圆点，便于一眼看清当前位置
 *   - 顺带一条灰色基线（区间起点位置）便于判断当前价格相对位置
 */
"use client";

import { cn } from "@/lib/utils";

interface SparklineProps {
  values: number[];
  /** 整体宽度（像素） */
  width?: number;
  /** 整体高度（像素） */
  height?: number;
  /** 末端是否绘制圆点 */
  showDot?: boolean;
  className?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 32,
  showDot = true,
  className,
}: SparklineProps) {
  if (!values || values.length < 2) {
    return (
      <span className="text-ink-mute text-xs">—</span>
    );
  }

  const first = values[0];
  const last = values[values.length - 1];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  // 留出 1px 内边距防止描边/圆点被裁切
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const xStep = w / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - (v - min) / range) * h;
    return [x, y] as const;
  });
  const pathD = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  // 区间涨跌：起点 vs 终点
  const up = last >= first;
  const stroke = up ? "#16A34A" : "#DC2626"; // bull / bear
  const fillUnder = up
    ? "rgba(22,163,74,0.12)"
    : "rgba(220,38,38,0.12)";

  // 起点处的水平基线（灰）
  const baseY = pad + (1 - (first - min) / range) * h;

  // 面积填充：起于第一个点、沿曲线、回到底
  const areaD =
    `M${points[0][0].toFixed(2)},${(pad + h).toFixed(2)} ` +
    points.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`).join(" ") +
    ` L${points[points.length - 1][0].toFixed(2)},${(pad + h).toFixed(2)} Z`;

  const [lastX, lastY] = points[points.length - 1];
  const changePct = ((last - first) / first) * 100;

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        aria-label={`近 ${values.length} 个交易日走势`}
      >
        <path d={areaD} fill={fillUnder} />
        {/* 起点基线 */}
        <line
          x1={pad}
          x2={width - pad}
          y1={baseY}
          y2={baseY}
          stroke="rgba(148,163,184,0.25)"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
        <path
          d={pathD}
          fill="none"
          stroke={stroke}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {showDot && (
          <circle cx={lastX} cy={lastY} r={2.2} fill={stroke} />
        )}
      </svg>
      <span
        className={cn(
          "text-xs font-mono whitespace-nowrap",
          up ? "text-bull" : "text-bear"
        )}
      >
        {up ? "+" : ""}
        {changePct.toFixed(1)}%
      </span>
    </div>
  );
}
