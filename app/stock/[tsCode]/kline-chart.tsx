"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type Time,
  CrosshairMode,
} from "lightweight-charts";

interface Bar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MAPoint {
  time: string;
  value: number | null;
}

interface Props {
  kline: Bar[];
  ma5: MAPoint[];
  ma10: MAPoint[];
  ma20: MAPoint[];
  ma60: MAPoint[];
}

export default function KLineChart({ kline, ma5, ma10, ma20, ma60 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 高度随宽度自适应：手机 ~ 320，桌面封顶 480
    const calcHeight = (w: number) =>
      Math.max(300, Math.min(480, Math.round(w * 0.7)));

    const initWidth = containerRef.current.clientWidth;
    const chart = createChart(containerRef.current, {
      width: initWidth,
      height: calcHeight(initWidth),
      layout: {
        background: { color: "#161a23" },
        textColor: "#a8b0c0",
      },
      grid: {
        vertLines: { color: "#222837" },
        horzLines: { color: "#222837" },
      },
      rightPriceScale: { borderColor: "#222837" },
      timeScale: {
        borderColor: "#222837",
        timeVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const candle = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candle.setData(
      kline.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
    );

    const vol = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "#3a4456",
    });
    vol.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    vol.setData(
      kline.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color:
          b.close >= b.open ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
      }))
    );

    const addLine = (data: MAPoint[], color: string, label: string) => {
      const s = chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: label,
      });
      s.setData(
        data
          .filter((p) => p.value != null)
          .map((p) => ({ time: p.time as Time, value: p.value as number }))
      );
    };
    addLine(ma5, "#fbbf24", "MA5");
    addLine(ma10, "#22d3ee", "MA10");
    addLine(ma20, "#a78bfa", "MA20");
    addLine(ma60, "#94a3b8", "MA60");

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        chart.applyOptions({ width: w, height: calcHeight(w) });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [kline, ma5, ma10, ma20, ma60]);

  return <div ref={containerRef} className="w-full" />;
}
