"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card, Segmented } from "@/components/ui/controls";
import type { ScanResult } from "@/lib/backtest/scan";
import { fmtPct } from "@/lib/format";

export interface ScanAxis {
  label: string;
  values: number[];
  format: (value: number) => string;
}

type Metric = "returnPct" | "calmar" | "maxDrawdown";

const METRIC_OPTIONS: { value: Metric; label: string }[] = [
  { value: "returnPct", label: "收益率" },
  { value: "calmar", label: "收益回撤比" },
  { value: "maxDrawdown", label: "最大回撤" },
];

/** undefined = 尚未计算，null = 参数组合不适用 */
type Cell = ScanResult | null | undefined;

interface ScanState {
  key: string;
  results: Cell[][];
  done: number;
}

/**
 * 二维参数扫描热力图。run 为同步回测函数，按行分批执行并让出主线程以显示进度；
 * runKey 变化（数据或其他参数改变）时旧结果失效。
 */
export function ParamScanCard({
  title,
  description,
  rows,
  cols,
  runKey,
  run,
  onApply,
  controls,
}: {
  title: string;
  description: ReactNode;
  rows: ScanAxis;
  cols: ScanAxis;
  runKey: string;
  run: (row: number, col: number) => ScanResult | null;
  onApply?: (row: number, col: number) => void;
  controls?: ReactNode;
}) {
  const [state, setState] = useState<ScanState | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("returnPct");
  const latestKey = useRef(runKey);

  useEffect(() => {
    latestKey.current = runKey;
  });

  const current = state?.key === runKey ? state : null;
  const running = runningKey === runKey;
  const total = rows.values.length * cols.values.length;

  const start = async () => {
    const key = runKey;
    const results = rows.values.map(() => cols.values.map((): Cell => undefined));
    let done = 0;
    setRunningKey(key);
    setState({ key, results, done });
    for (let i = 0; i < rows.values.length; i++) {
      // 让出主线程，页面可以刷新进度
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (latestKey.current !== key) {
        setRunningKey(null);
        return;
      }
      for (let j = 0; j < cols.values.length; j++) {
        results[i][j] = run(rows.values[i], cols.values[j]);
        done++;
      }
      setState({ key, results: results.map((row) => row.slice()), done });
    }
    setRunningKey(null);
  };

  const values = current?.results.flat().filter((r): r is ScanResult => r !== null && r !== undefined) ?? [];
  const valueOf = (r: ScanResult) => (metric === "calmar" ? (r.calmar ?? 0) : r[metric]);
  const maxAbs = Math.max(1e-12, ...values.map((r) => Math.abs(valueOf(r))));
  const best =
    values.length === 0
      ? null
      : values.reduce((a, b) =>
          metric === "maxDrawdown" ? (valueOf(b) < valueOf(a) ? b : a) : valueOf(b) > valueOf(a) ? b : a,
        );

  const cellStyle = (r: ScanResult) => {
    const v = valueOf(r);
    const strength = 0.1 + 0.6 * (Math.abs(v) / maxAbs);
    const positive = metric === "maxDrawdown" ? false : v >= 0;
    return { backgroundColor: positive ? `rgba(14,203,129,${strength})` : `rgba(246,70,93,${strength})` };
  };

  const cellText = (r: ScanResult) => {
    if (r.liquidated) return "爆仓";
    if (metric === "calmar") return r.calmar === null ? "—" : r.calmar.toFixed(2);
    if (metric === "maxDrawdown") return fmtPct(-r.maxDrawdown, true, 1);
    return fmtPct(r.returnPct, true, 1);
  };

  return (
    <Card
      title={title}
      extra={
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <Segmented size="sm" value={metric} onChange={setMetric} options={METRIC_OPTIONS} />
          <button
            type="button"
            onClick={start}
            disabled={running}
            className="h-7 rounded bg-accent px-3 text-xs font-medium text-black hover:bg-accent/90 disabled:opacity-60"
          >
            {running ? `扫描中 ${current?.done ?? 0}/${total}` : current ? "重新扫描" : `开始扫描（${total} 组）`}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-[11px] leading-relaxed text-muted">{description}</p>
        {current ? (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="whitespace-nowrap px-2 py-1 text-left font-normal text-muted">
                    {rows.label} ＼ {cols.label}
                  </th>
                  {cols.values.map((c) => (
                    <th key={c} className="num px-1 py-1 text-center font-normal text-muted">
                      {cols.format(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.values.map((rowValue, i) => (
                  <tr key={rowValue}>
                    <th className="num whitespace-nowrap px-2 py-0.5 text-left font-normal text-muted">
                      {rows.format(rowValue)}
                    </th>
                    {cols.values.map((colValue, j) => {
                      const r = current.results[i][j];
                      return (
                        <td key={colValue} className="p-0.5">
                          {r ? (
                            <button
                              type="button"
                              onClick={() => onApply?.(rowValue, colValue)}
                              style={cellStyle(r)}
                              title={`${rows.label} ${rows.format(rowValue)}，${cols.label} ${cols.format(colValue)}\n收益率 ${fmtPct(r.returnPct)}，最大回撤 ${fmtPct(-r.maxDrawdown)}，成交 ${r.trades} 笔${onApply ? "\n点击套用该参数" : ""}`}
                              className={`num h-8 w-[4.5rem] rounded text-fg transition-transform hover:scale-105 ${
                                r === best ? "ring-2 ring-accent" : ""
                              }`}
                            >
                              {cellText(r)}
                            </button>
                          ) : r === null ? (
                            <div
                              className="flex h-8 w-[4.5rem] items-center justify-center rounded bg-panel-2/50 text-muted"
                              title="该参数组合不适用"
                            >
                              —
                            </div>
                          ) : (
                            <div className="h-8 w-[4.5rem] animate-pulse rounded bg-panel-2" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-muted">点击「开始扫描」计算每组参数的回测结果</div>
        )}
      </div>
    </Card>
  );
}
