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
        background: { color: "#FFFFFF" },
        textColor: "#475569",
      },
      grid: {
        vertLines: { color: "#E2E8F0" },
        horzLines: { color: "#E2E8F0" },
      },
      rightPriceScale: { borderColor: "#E2E8F0" },
      timeScale: {
        borderColor: "#E2E8F0",
        timeVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const candle = chart.addCandlestickSeries({
      upColor: "#16A34A",
      downColor: "#DC2626",
      borderVisible: false,
      wickUpColor: "#16A34A",
      wickDownColor: "#DC2626",
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
      color: "#94A3B8",
    });
    vol.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    vol.setData(
      kline.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color:
          b.close >= b.open ? "rgba(22,163,74,0.5)" : "rgba(220,38,38,0.5)",
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
    addLine(ma5, "#D97706", "MA5");
    addLine(ma10, "#0891B2", "MA10");
    addLine(ma20, "#7C3AED", "MA20");
    addLine(ma60, "#475569", "MA60");

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
