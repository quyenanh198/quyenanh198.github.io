// Generates the monthly market report for the most recent completed calendar
// month into src/reports/. Run: node scripts/generate-monthly.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  fetchDaily, toMonthly, completedMonths, pctChange,
  fmtPct, fmtPrice, fmtRatio, average,
} from "./lib/marketdata.mjs";

const OUT_DIR = "src/reports";
const today = new Date();
const watchlist = JSON.parse(await readFile("src/_data/watchlist.json", "utf8"));

// Month stats for the last completed month: % month, % 3 months, % YTD.
function monthlyStats(dailyRows) {
  const months = completedMonths(toMonthly(dailyRows), today);
  if (months.length < 4) return null;
  const m = months.at(-1);
  const prev = months.at(-2);
  const m3 = months.at(-4);
  const year = m.month.slice(0, 4);
  const prevYearClose = months.findLast((x) => x.month < `${year}-01`)?.close;
  const dollarVol = (x) => x.close * x.volume;
  const prior3 = months.slice(-4, -1);
  return {
    month: m,
    close: m.close,
    pctMonth: pctChange(m.close, prev.close),
    pct3m: pctChange(m.close, m3.close),
    pctYtd: prevYearClose ? pctChange(m.close, prevYearClose) : NaN,
    dollarVolRatio: dollarVol(m) / average(prior3.map(dollarVol)),
  };
}

const symbols = [
  ...watchlist.benchmarks.map((b) => b.symbol),
  ...watchlist.sectors.map((s) => s.symbol),
];
const stats = {};
for (const symbol of symbols) {
  const rows = await fetchDaily(symbol, { today });
  const st = rows && monthlyStats(rows);
  if (st) stats[symbol] = st;
  else console.warn(`[monthly] skipping ${symbol}: no usable data`);
}

const missing = symbols.filter((s) => !stats[s]);
if (!stats.SPY || missing.length > symbols.length * 0.3) {
  console.error(`[monthly] aborting: too much missing data (${missing.join(", ") || "SPY"})`);
  process.exit(1);
}

const spy = stats.SPY;
const [year, monthNum] = spy.month.month.split("-");
const monthLabel = `${Number(monthNum)}/${year}`;
const reportDate = spy.month.lastDate;

const benchRows = watchlist.benchmarks.filter((b) => stats[b.symbol]).map((b) => ({ ...b, s: stats[b.symbol] }));
const sectorRows = watchlist.sectors
  .filter((x) => stats[x.symbol])
  .map((x) => ({ ...x, s: stats[x.symbol] }))
  .sort((a, b) => b.s.pctMonth - a.s.pctMonth);

const upCount = benchRows.filter((r) => r.s.pctMonth > 0).length;
const leader = [...benchRows].sort((a, b) => b.s.pctMonth - a.s.pctMonth)[0];
const topSectors = sectorRows.slice(0, 3);
const bottomSectors = sectorRows.slice(-3).reverse();
const defensiveTop = topSectors.filter((r) => ["XLU", "XLP", "XLV"].includes(r.symbol)).length >= 2;

const tone =
  upCount === benchRows.length ? `tăng đồng thuận trên cả bốn chỉ số, dẫn đầu là ${leader.symbol} (${fmtPct(leader.s.pctMonth)})` :
  upCount >= benchRows.length / 2 ? `tăng không đồng đều — ${leader.symbol} mạnh nhất (${fmtPct(leader.s.pctMonth)}) trong khi ${benchRows.length - upCount} chỉ số giảm` :
  upCount > 0 ? "phân hóa với đa số chỉ số giảm điểm" : "giảm trên diện rộng";
const regime = defensiveTop
  ? "Nhóm dẫn dắt nghiêng về phòng thủ (Tiện ích / Tiêu dùng thiết yếu / Y tế) — thị trường tăng/giữ giá nhưng khẩu vị rủi ro đang thu hẹp."
  : "Nhóm dẫn dắt thuộc các ngành chu kỳ/tăng trưởng — đặc trưng của chế độ thị trường risk-on.";

const body = `---
layout: report.njk
title: "Thị trường tháng ${monthLabel}"
date: ${reportDate}
reportType: monthly
tickers: [${benchRows.map((r) => r.symbol).join(", ")}]
excerpt: "S&P 500 ${fmtPct(spy.pctMonth)} trong tháng ${monthLabel} (YTD ${fmtPct(spy.pctYtd)}); ${topSectors[0].name} dẫn đầu các ngành với ${fmtPct(topSectors[0].s.pctMonth)}."
---
## Tổng quan tháng

Tháng ${monthLabel} khép lại với thị trường ${tone}. Tính từ đầu năm, S&P 500 (SPY) ${spy.pctYtd >= 0 ? "tăng" : "giảm"} ${fmtPct(spy.pctYtd)}; quy mô 3 tháng gần nhất đạt ${fmtPct(spy.pct3m)}. ${regime}

## Bảng chỉ số

| Chỉ số (ETF) | Đóng tháng | % tháng | % 3 tháng | % YTD |
|---|---:|---:|---:|---:|
${benchRows.map((r) => `| ${r.name} | ${fmtPrice(r.s.close)} | ${fmtPct(r.s.pctMonth)} | ${fmtPct(r.s.pct3m)} | ${fmtPct(r.s.pctYtd)} |`).join("\n")}

## Xếp hạng ngành theo tháng

| Ngành (ETF) | % tháng | % 3 tháng | Dòng tiền/TB 3 tháng |
|---|---:|---:|---:|
${sectorRows.map((r) => `| ${r.name} (${r.symbol}) | ${fmtPct(r.s.pctMonth)} | ${fmtPct(r.s.pct3m)} | ${fmtRatio(r.s.dollarVolRatio)} |`).join("\n")}

**Mạnh nhất**: ${topSectors.map((r) => `${r.name} (${fmtPct(r.s.pctMonth)})`).join(", ")}.
**Yếu nhất**: ${bottomSectors.map((r) => `${r.name} (${fmtPct(r.s.pctMonth)})`).join(", ")}.

## Nhìn về tháng tới

- Quan sát liệu nhóm dẫn dắt tháng qua (${topSectors[0].symbol}, ${topSectors[1].symbol}) có duy trì sức mạnh tương đối — sự luân chuyển kéo dài từ 2 tháng trở lên thường là xu hướng đáng tin cậy.
- SPY: mốc tham chiếu gần nhất là đỉnh/đáy tháng ${fmtPrice(spy.month.high)} / ${fmtPrice(spy.month.low)}; thủng đáy tháng là tín hiệu thay đổi cấu trúc xu hướng.
- ${bottomSectors[0].name} yếu nhất tháng — theo dõi tín hiệu tạo đáy (tuần tăng đầu tiên kèm khối lượng) trước khi kỳ vọng hồi phục.
`;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/${reportDate}-monthly-market.md`, body);
console.log(`[monthly] wrote ${reportDate}-monthly-market.md`);
if (missing.length) console.warn(`[monthly] done with missing symbols: ${missing.join(", ")}`);
