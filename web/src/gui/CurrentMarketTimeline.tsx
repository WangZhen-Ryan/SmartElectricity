import { useEffect, useMemo, useRef } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";

import { formatAmberPrice, formatTimestamp } from "../core/utils";

type RawInterval = {
  startTime: string;
  perKwh: number;
  channelType: string;
};

type SeriesPoint = { time: number; value: number };

function buildSeries(rows: RawInterval[] | null, channelType: string): SeriesPoint[] {
  if (!rows?.length) return [];
  return rows
    .filter((item) => item.channelType === channelType)
    .map((item) => ({
      time: Math.floor(new Date(item.startTime).getTime() / 1000),
      value: item.perKwh,
    }))
    .sort((a, b) => a.time - b.time);
}

export function CurrentMarketTimeline({
  title,
  rows,
  tone = "primary",
}: {
  title: string;
  rows: RawInterval[] | null;
  tone?: "primary" | "secondary";
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const buySeries = useMemo(() => buildSeries(rows, "general"), [rows]);
  const sellSeries = useMemo(() => buildSeries(rows, "feedIn"), [rows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    container.innerHTML = "";

    const chart = createChart(container, {
      height: 200,
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "rgba(226, 232, 240, 0.85)",
        fontFamily: "Manrope, sans-serif",
      },
      grid: {
        horzLines: { color: "rgba(148, 163, 184, 0.12)" },
        vertLines: { color: "rgba(148, 163, 184, 0.12)" },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "rgba(226, 232, 240, 0.2)" },
        horzLine: { color: "rgba(226, 232, 240, 0.2)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
      },
    });

    const buyColor = tone === "primary" ? "rgba(56, 189, 248, 0.9)" : "rgba(56, 189, 248, 0.55)";
    const sellColor = tone === "primary" ? "rgba(251, 191, 36, 0.9)" : "rgba(251, 191, 36, 0.6)";

    const buyLine = chart.addLineSeries({
      color: buyColor,
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: true,
      priceFormat: {
        type: "custom",
        minMove: 0.01,
        formatter: (value: number) => `${value.toFixed(2)}¢`,
      },
    });
    const sellLine = chart.addLineSeries({
      color: sellColor,
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: true,
      priceFormat: {
        type: "custom",
        minMove: 0.01,
        formatter: (value: number) => `${value.toFixed(2)}¢`,
      },
    });

    buyLine.setData(buySeries);
    sellLine.setData(sellSeries);
    chart.timeScale().fitContent();

    const tooltip = document.createElement("div");
    tooltip.className = "timeline-tooltip";
    tooltip.style.display = "none";
    container.appendChild(tooltip);
    tooltipRef.current = tooltip;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        tooltip.style.display = "none";
        return;
      }
      const time = new Date(param.time as number * 1000).toISOString();
      const buy = param.seriesData.get(buyLine) as { value?: number } | undefined;
      const sell = param.seriesData.get(sellLine) as { value?: number } | undefined;
      const buyValue = buy?.value !== undefined ? formatAmberPrice(buy.value) : "—";
      const sellValue = sell?.value !== undefined ? formatAmberPrice(sell.value) : "—";
      tooltip.innerHTML = `
        <div class="timeline-tooltip-title">${formatTimestamp(time)}</div>
        <div class="timeline-tooltip-row buy">Buy: ${buyValue}</div>
        <div class="timeline-tooltip-row sell">Sell: ${sellValue}</div>
      `;
      tooltip.style.display = "block";
      const { x, y } = param.point;
      tooltip.style.left = `${Math.min(x + 12, container.clientWidth - 180)}px`;
      tooltip.style.top = `${Math.min(y + 12, container.clientHeight - 90)}px`;
    });

    const observer = new ResizeObserver(() => {
      chart.timeScale().fitContent();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [buySeries, sellSeries, tone]);

  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <span className="timeline-title">{title}</span>
        <div className="timeline-legend">
          <span className="legend buy">Buy</span>
          <span className="legend sell">Sell</span>
        </div>
      </div>
      <div className="timeline-chart" ref={containerRef} />
    </div>
  );
}
