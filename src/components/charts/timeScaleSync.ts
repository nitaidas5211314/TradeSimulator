import type { IChartApi, LogicalRange } from "lightweight-charts";

/** 同步多个图表的可视时间范围（要求各图表数据点一一对应） */
export interface TimeScaleSync {
  add(chart: IChartApi): () => void;
  /** 所有图表统一缩放到完整数据范围 */
  fit(): void;
}

// fit 期间图表会异步触发多次范围变化事件，这段时间内不互相同步，避免被默认范围覆盖
const FIT_DELAY_MS = 50;
const FIT_SUPPRESS_MS = 250;

export function createTimeScaleSync(): TimeScaleSync {
  const charts = new Set<IChartApi>();
  let syncing = false;
  let suppressUntil = 0;
  let fitTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    add(chart) {
      charts.add(chart);
      const handler = (range: LogicalRange | null) => {
        if (syncing || !range || Date.now() < suppressUntil) return;
        syncing = true;
        try {
          for (const other of charts) {
            if (other !== chart) other.timeScale().setVisibleLogicalRange(range);
          }
        } finally {
          syncing = false;
        }
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
      return () => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
        charts.delete(chart);
      };
    },

    fit() {
      if (fitTimer) clearTimeout(fitTimer);
      suppressUntil = Date.now() + FIT_DELAY_MS + FIT_SUPPRESS_MS;
      // 延迟到 autoSize 完成尺寸测量之后再缩放
      fitTimer = setTimeout(() => {
        fitTimer = null;
        suppressUntil = Date.now() + FIT_SUPPRESS_MS;
        for (const chart of charts) chart.timeScale().fitContent();
      }, FIT_DELAY_MS);
    },
  };
}
