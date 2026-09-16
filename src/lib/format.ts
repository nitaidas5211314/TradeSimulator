/** 根据价格量级决定显示精度 */
export function pricePrecision(price: number): number {
  const abs = Math.abs(price);
  if (abs >= 1000) return 2;
  if (abs >= 10) return 3;
  if (abs >= 1) return 4;
  if (abs >= 0.01) return 5;
  if (abs >= 0.0001) return 7;
  return 9;
}

export function roundPrice(price: number): number {
  const digits = pricePrecision(price);
  return Number(price.toFixed(digits));
}

export function fmtPrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: pricePrecision(price),
  });
}

export function fmtNumber(value: number, digits = 2): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtQty(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtUsd(value: number, signed = false): string {
  // 先按显示精度取整再判断正负，避免出现 "-0.00"
  const rounded = Math.round(value * 100) / 100;
  const text = fmtNumber(Math.abs(rounded));
  if (rounded < 0) return `-${text}`;
  return signed && rounded > 0 ? `+${text}` : text;
}

export function fmtPct(ratio: number | null, signed = true, digits = 2): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  const text = `${(Math.abs(ratio) * 100).toFixed(digits)}%`;
  if (ratio < 0) return `-${text}`;
  return signed && ratio > 0 ? `+${text}` : text;
}

/** 持续时长，如 3天5小时 / 2小时8分 / 45秒 */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
  if (minutes > 0) return `${minutes}分`;
  return `${sec}秒`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC 时间 yyyy-MM-dd HH:mm */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** UTC 时间 HH:mm:ss */
export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** UTC 日期 yyyy-MM-dd */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 解析 yyyy-MM-dd 为 UTC 零点毫秒 */
export function parseDateUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function pnlClass(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-muted";
}
