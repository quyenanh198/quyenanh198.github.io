// Generates the three weekly reports (market, sector flow, ticker watchlist)
// into src/reports/, plus a synthesized weekly analysis article into
// src/posts/ that appears in the blog. Run: node scripts/generate-weekly.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  fetchDaily, weeklyStats, technicalStats, fmtPct, fmtPrice, fmtRatio,
  weekRangeLabel, average,
} from "./lib/marketdata.mjs";

const OUT_DIR = "src/reports";
const POSTS_DIR = "src/posts";
const RISK_ON = ["XLK", "XLY", "XLF"];
const DEFENSIVE = ["XLU", "XLP", "XLV"];

const today = new Date();
const watchlist = JSON.parse(await readFile("src/_data/watchlist.json", "utf8"));

// ---- Fetch everything ----
const symbols = [
  ...watchlist.benchmarks.map((b) => b.symbol),
  ...watchlist.sectors.map((s) => s.symbol),
  ...watchlist.tickers.map((t) => t.symbol),
];
const stats = {};
const tech = {};
for (const symbol of symbols) {
  const rows = await fetchDaily(symbol, { today });
  const st = rows && weeklyStats(rows, today);
  if (st) {
    stats[symbol] = st;
    tech[symbol] = technicalStats(rows, today);
  } else console.warn(`[weekly] skipping ${symbol}: no usable data`);
}

const missing = symbols.filter((s) => !stats[s]);
if (!stats.SPY || missing.length > symbols.length * 0.3) {
  console.error(`[weekly] aborting: too much missing data (${missing.join(", ") || "SPY"})`);
  process.exit(1);
}

const spy = stats.SPY;
const range = weekRangeLabel(spy.week.firstDate, spy.week.lastDate);
const reportDate = spy.week.lastDate; // dated by the trading week it covers
await mkdir(OUT_DIR, { recursive: true });
await mkdir(POSTS_DIR, { recursive: true });

const frontMatter = (o) =>
  [
    "---",
    `layout: ${o.layout ?? "report.njk"}`,
    `title: "${o.title}"`,
    `date: ${reportDate}`,
    ...(o.type ? [`reportType: ${o.type}`] : []),
    ...(o.tickers ? [`tickers: [${o.tickers.join(", ")}]`] : []),
    `excerpt: "${o.excerpt}"`,
    "---",
  ].join("\n");

const dir = (x, up, flat, down, eps = 0.15) => (x > eps ? up : x < -eps ? down : flat);
const short = (name) => name.split(" (")[0];

// ---- Indicator narration helpers ----

const trendText = (t) =>
  t.trend === "up"
    ? `**xu hướng tăng** — giá trên SMA20 (${fmtPrice(t.sma20)}) và SMA20 trên SMA50 (${fmtPrice(t.sma50)})${t.aboveSma200 === true ? ", đồng pha với xu hướng dài hạn trên SMA200" : t.aboveSma200 === false ? `, nhưng vẫn dưới SMA200 (${fmtPrice(t.sma200)}) nên xu hướng dài hạn chưa xác nhận` : ""}`
    : t.trend === "down"
    ? `**xu hướng giảm** — giá dưới SMA20 (${fmtPrice(t.sma20)}) và SMA20 dưới SMA50 (${fmtPrice(t.sma50)})${t.aboveSma200 === false ? ", đồng thời nằm dưới SMA200 — xu hướng giảm trên mọi khung" : ""}`
    : `**đi ngang / hỗn hợp** — giá ${t.close > t.sma20 ? "trên" : "dưới"} SMA20 (${fmtPrice(t.sma20)}) trong khi SMA50 (${fmtPrice(t.sma50)}) đi phẳng`;

const momentumText = (t) => {
  const r = t.rsi14;
  const rsiPart =
    r >= 70 ? `RSI(14) ở ${r.toFixed(0)} — vùng quá mua, xác suất rung lắc ngắn hạn cao` :
    r <= 30 ? `RSI(14) ở ${r.toFixed(0)} — vùng quá bán, dễ có nhịp hồi kỹ thuật` :
    r >= 55 ? `RSI(14) ở ${r.toFixed(0)} — động lượng tích cực` :
    r > 45 ? `RSI(14) trung tính quanh ${r.toFixed(0)}` :
    `RSI(14) ở ${r.toFixed(0)} — động lượng suy yếu`;
  const m = t.macd;
  const macdPart = !m ? "" :
    m.hist > 0 && m.hist >= m.prevHist ? "; MACD trên đường tín hiệu với histogram mở rộng — lực tăng còn khỏe" :
    m.hist > 0 ? "; MACD còn trên đường tín hiệu nhưng histogram đang thu hẹp — đà tăng chậm lại" :
    m.hist < 0 && m.hist <= m.prevHist ? "; MACD dưới đường tín hiệu, histogram nới rộng chiều âm — áp lực bán chưa dừng" :
    "; MACD dưới đường tín hiệu nhưng histogram thu hẹp — lực bán yếu dần";
  return rsiPart + macdPart;
};

// Reference entry/stop/target zones derived from trend, MAs, ATR and swing levels.
const planFor = (t) => {
  const a = Number.isFinite(t.atr14) ? t.atr14 : t.close * 0.02;
  if (t.trend === "up") {
    const target = t.close >= t.high13w * 0.98 ? t.close + 2 * a : t.high13w;
    const stop = Math.min(t.swingLow4w, t.sma20 - a);
    return {
      entry: t.rsi14 >= 70
        ? `RSI đang quá mua nên tránh mua đuổi; vùng mua hợp lý là nhịp điều chỉnh về ${fmtPrice(t.sma20)}–${fmtPrice(t.sma20 + a)} (quanh SMA20)`
        : `nhịp điều chỉnh về ${fmtPrice(t.sma20)}–${fmtPrice(t.sma20 + a)} (quanh SMA20), hoặc mua theo đà khi vượt ${fmtPrice(Math.max(t.swingHigh4w, t.close))} kèm khối lượng lớn`,
      stop, target,
    };
  }
  if (t.trend === "down") {
    return {
      down: true,
      entry: `chưa có điểm mua thuận xu hướng — chỉ cân nhắc giải ngân khi giá đóng tuần lấy lại SMA50 (${fmtPrice(t.sma50)})`,
      exitNote: `nếu đang nắm giữ, các nhịp hồi về SMA20 (${fmtPrice(t.sma20)}) là vùng hạ tỷ trọng; hỗ trợ sâu hơn tại đáy 13 tuần ${fmtPrice(t.low13w)}`,
    };
  }
  return {
    entry: `canh mua tại cận dưới biên tích lũy ${fmtPrice(t.swingLow4w)}–${fmtPrice(t.swingLow4w + a)}, ưu tiên khi RSI quay đầu hướng lên`,
    stop: t.swingLow4w - a,
    target: t.swingHigh4w,
  };
};

const planText = (t) => {
  const p = planFor(t);
  if (p.down) return `- **Điểm mua tham khảo**: ${p.entry}.\n- **Quản trị vị thế**: ${p.exitNote}.`;
  const riskPct = ((t.close - p.stop) / t.close) * 100;
  const upsidePct = ((p.target - t.close) / t.close) * 100;
  return [
    `- **Điểm mua tham khảo**: ${p.entry}.`,
    `- **Dừng lỗ**: dưới ${fmtPrice(p.stop)} (rủi ro ~${riskPct.toFixed(1)}% từ giá hiện tại).`,
    `- **Mục tiêu / vùng chốt lời**: ${fmtPrice(p.target)} (dư địa ~${upsidePct.toFixed(1)}%${p.target > t.high13w * 0.999 && t.close >= t.high13w * 0.98 ? ", ước theo 2×ATR do giá đang ở vùng đỉnh" : ""}).`,
  ].join("\n");
};

const techParagraph = (t) =>
  `Xu hướng: ${trendText(t)}. Động lượng: ${momentumText(t)}. Biến động trung bình (ATR14) ${fmtPrice(t.atr14)}/phiên.`;

// ---- Shared derived data ----

// Benchmarks
const benchRows = watchlist.benchmarks
  .filter((b) => stats[b.symbol])
  .map((b) => ({ ...b, s: stats[b.symbol], shortName: short(b.name) }));
const upCount = benchRows.filter((r) => r.s.pctWeek > 0).length;
const leader = [...benchRows].sort((a, b) => b.s.pctWeek - a.s.pctWeek)[0];
const laggard = [...benchRows].sort((a, b) => a.s.pctWeek - b.s.pctWeek)[0];
const avgVolRatio = average(benchRows.map((r) => r.s.dollarVolRatio));
const tone =
  upCount === benchRows.length ? "đồng thuận tăng trên cả bốn chỉ số" :
  upCount > benchRows.length / 2 ? "tăng trên diện rộng dù chưa đồng thuận" :
  upCount === benchRows.length / 2 ? "phân hóa, sắc xanh và sắc đỏ đan xen" :
  upCount > 0 ? "phân hóa với sắc đỏ chiếm ưu thế" : "giảm đồng loạt";
const volNote =
  avgVolRatio >= 1.1 ? `Thanh khoản cao hơn trung bình 4 tuần (~${fmtRatio(avgVolRatio)}), cho thấy dòng tiền lớn đang tham gia tích cực.` :
  avgVolRatio <= 0.8 ? `Thanh khoản chỉ đạt ~${fmtRatio(avgVolRatio)} trung bình 4 tuần — biến động tuần này chưa được dòng tiền lớn xác nhận.` :
  `Thanh khoản xấp xỉ trung bình 4 tuần (~${fmtRatio(avgVolRatio)}).`;

// Sectors, ranked by weekly performance
const sectorRows = watchlist.sectors
  .filter((x) => stats[x.symbol])
  .map((x) => {
    const s = stats[x.symbol];
    const rs = s.pctWeek - spy.pctWeek;
    const label =
      rs > 0 && s.pctWeek > 0 && s.dollarVolRatio >= 1 ? "Hút tiền" :
      s.pctWeek < 0 && s.dollarVolRatio >= 0.9 ? "Bị rút tiền" :
      rs > 0 && s.pctWeek > 0 ? "Tăng, thanh khoản mỏng" :
      s.pctWeek < 0 ? "Yếu, thanh khoản mỏng" : "Trung tính";
    return { ...x, s, rs, label, shortName: short(x.name) };
  })
  .sort((a, b) => b.s.pctWeek - a.s.pctWeek);
const topSector = sectorRows[0];
const bottomSector = sectorRows.at(-1);
const riskOnRs = average(sectorRows.filter((r) => RISK_ON.includes(r.symbol)).map((r) => r.rs));
const defRs = average(sectorRows.filter((r) => DEFENSIVE.includes(r.symbol)).map((r) => r.rs));
const tilt =
  riskOnRs > defRs + 0.3 ? "nghiêng rõ về **risk-on**: nhóm Công nghệ / Tiêu dùng không thiết yếu / Tài chính mạnh hơn nhóm phòng thủ" :
  defRs > riskOnRs + 0.3 ? "nghiêng về **phòng thủ**: Tiện ích / Tiêu dùng thiết yếu / Y tế mạnh hơn nhóm risk-on — một bộ phận dòng tiền đang hạ khẩu vị rủi ro" :
  "khá cân bằng giữa nhóm risk-on và nhóm phòng thủ";
const inflows = sectorRows.filter((r) => r.label === "Hút tiền");
const outflows = sectorRows.filter((r) => r.label === "Bị rút tiền");
const highVol = sectorRows.filter((r) => r.s.dollarVolRatio >= 1.05);

// Watchlist tickers, ranked by weekly performance
const tickerRows = watchlist.tickers
  .filter((t) => stats[t.symbol])
  .map((t) => ({ ...t, s: stats[t.symbol] }))
  .sort((a, b) => b.s.pctWeek - a.s.pctWeek);
const bestTicker = tickerRows[0];
const worstTicker = tickerRows.at(-1);
const nearHigh = [...tickerRows].sort((a, b) => b.s.fromHigh13w - a.s.fromHigh13w)[0];

// ---- 1. Weekly market report ----
{
  const note = (s) =>
    s.pctWeek > 1.5 ? "Tăng mạnh, dẫn dắt thị trường" :
    s.pctWeek > 0.15 ? (s.fromHigh13w > -2 ? "Tăng, giao dịch sát vùng đỉnh" : "Hồi phục") :
    s.pctWeek < -1.5 ? "Giảm mạnh" :
    s.pctWeek < -0.15 ? "Điều chỉnh nhẹ" : "Đi ngang tích lũy";
  const iwm = stats.IWM;

  const body = `${frontMatter({
    title: `Thị trường tuần ${range}`,
    type: "weekly",
    tickers: benchRows.map((r) => r.symbol),
    excerpt: `S&P 500 ${fmtPct(spy.pctWeek)} trong tuần; ${leader.shortName} dẫn dắt (${fmtPct(leader.s.pctWeek)}); tính 4 tuần SPY ${fmtPct(spy.pct4w)}.`,
  })}
## Tổng quan

Tuần giao dịch ${range} khép lại với thị trường ${tone}. ${leader.shortName} (${leader.symbol}) ${dir(leader.s.pctWeek, `tăng tốt nhất với ${fmtPct(leader.s.pctWeek)}`, `gần như đi ngang (${fmtPct(leader.s.pctWeek)})`, `giảm ít nhất (${fmtPct(leader.s.pctWeek)})`)}, trong khi ${laggard.symbol} ${dir(laggard.s.pctWeek, "vẫn giữ được sắc xanh", "đi ngang", `yếu nhất với ${fmtPct(laggard.s.pctWeek)}`)}. Nhìn rộng hơn, S&P 500 (SPY) đã ${dir(spy.pct4w, `tăng ${fmtPct(spy.pct4w)}`, "gần như không đổi", `giảm ${fmtPct(spy.pct4w)}`, 0.5)} trong 4 tuần gần nhất${spy.fromHigh13w > -2 ? " và đang giao dịch sát vùng đỉnh 13 tuần" : spy.fromHigh13w < -8 ? ` và vẫn thấp hơn đỉnh 13 tuần ${fmtPct(spy.fromHigh13w)}` : ""}. ${volNote}

## Bảng chỉ số

| Chỉ số (ETF) | Đóng tuần | % tuần | % 4 tuần | KL/TB 4 tuần | Nhận xét |
|---|---:|---:|---:|---:|---|
${benchRows.map((r) => `| ${r.name} | ${fmtPrice(r.s.close)} | ${fmtPct(r.s.pctWeek)} | ${fmtPct(r.s.pct4w)} | ${fmtRatio(r.s.dollarVolRatio)} | ${note(r.s)} |`).join("\n")}

## Điểm nhấn

- **Ngành mạnh nhất**: ${topSector.shortName} (${topSector.symbol}) ${fmtPct(topSector.s.pctWeek)}; **yếu nhất**: ${bottomSector.shortName} (${bottomSector.symbol}) ${fmtPct(bottomSector.s.pctWeek)} — chi tiết trong báo cáo dòng tiền ngành cùng kỳ.
- **Độ rộng thị trường**: vốn hóa nhỏ (IWM ${fmtPct(iwm?.pctWeek ?? NaN)}) ${iwm && iwm.pctWeek > spy.pctWeek ? "tăng tốt hơn SPY — tín hiệu độ rộng tích cực" : "yếu hơn SPY — đà tăng vẫn phụ thuộc nhóm vốn hóa lớn"}.
- **Thanh khoản**: ${volNote}

## Tuần tới

- SPY: hỗ trợ gần nhất ${fmtPrice(spy.weekLow)} (đáy tuần), kháng cự ${fmtPrice(spy.weekHigh)} (đỉnh tuần) — mất hỗ trợ là tín hiệu điều chỉnh ngắn hạn đầu tiên.
- QQQ: quan sát vùng ${fmtPrice(stats.QQQ?.weekLow ?? NaN)}–${fmtPrice(stats.QQQ?.weekHigh ?? NaN)}; vượt đỉnh tuần kèm khối lượng cải thiện sẽ mở dư địa tăng mới cho nhóm công nghệ.
- Theo dõi liệu sức mạnh của ${topSector.shortName} (${topSector.symbol}) có duy trì sang tuần thứ hai để xác nhận xu hướng luân chuyển.
`;
  await writeFile(`${OUT_DIR}/${reportDate}-weekly-market.md`, body);
  console.log(`[weekly] wrote ${reportDate}-weekly-market.md`);
}

// ---- 2. Sector money flow report ----
{
  const body = `${frontMatter({
    title: `Dòng tiền ngành tuần ${range}`,
    type: "sector-flow",
    tickers: sectorRows.map((r) => r.symbol),
    excerpt: `${topSector.name} dẫn đầu (${fmtPct(topSector.s.pctWeek)}), ${bottomSector.name} yếu nhất (${fmtPct(bottomSector.s.pctWeek)}); cơ cấu dòng tiền ${riskOnRs > defRs ? "nghiêng risk-on" : "nghiêng phòng thủ"}.`,
  })}
## Bức tranh chung

Trong tuần ${range}, so với mức ${fmtPct(spy.pctWeek)} của SPY, dòng tiền dồn mạnh nhất vào **${topSector.shortName}** (${topSector.symbol} ${fmtPct(topSector.s.pctWeek)}) và rời khỏi **${bottomSector.shortName}** (${bottomSector.symbol} ${fmtPct(bottomSector.s.pctWeek)}). Cơ cấu sức mạnh tương đối tuần này ${tilt}.

## Bảng xếp hạng

RS = sức mạnh tương đối so với SPY (${fmtPct(spy.pctWeek)}). Dòng tiền = giá trị giao dịch tuần (giá × khối lượng) so với trung bình 4 tuần trước.

| Ngành (ETF) | % tuần | RS so SPY | Dòng tiền/TB 4 tuần | Phân loại |
|---|---:|---:|---:|---|
${sectorRows.map((r) => `| ${r.name} (${r.symbol}) | ${fmtPct(r.s.pctWeek)} | ${fmtPct(r.rs)} | ${fmtRatio(r.s.dollarVolRatio)} | ${r.label} |`).join("\n")}

## Phân tích luân chuyển

${inflows.length
    ? `Nhóm hút tiền rõ nhất tuần này: ${inflows.map((r) => `**${r.shortName}** (${r.symbol}, ${fmtPct(r.s.pctWeek)}, dòng tiền ${fmtRatio(r.s.dollarVolRatio)})`).join(", ")} — vừa vượt trội thị trường vừa có giá trị giao dịch từ mức trung bình trở lên, tín hiệu tích lũy chủ động.`
    : `Không ngành nào hội đủ cả hai điều kiện hút tiền (vượt SPY kèm giá trị giao dịch trên trung bình) — sự vượt trội của ${topSector.symbol} diễn ra trên nền thanh khoản ${fmtRatio(topSector.s.dollarVolRatio)}, cần thêm xác nhận.`}

${outflows.length
    ? `Ở chiều ngược lại, ${outflows.map((r) => `**${r.shortName}** (${r.symbol}, ${fmtPct(r.s.pctWeek)}, dòng tiền ${fmtRatio(r.s.dollarVolRatio)})`).join(", ")} giảm giá với giá trị giao dịch đáng kể — dấu hiệu phân phối chủ động thay vì chỉ thiếu người mua.`
    : `Chiều bán không có ngành nào bị rút tiền chủ động rõ rệt — các ngành giảm giá chủ yếu do thiếu lực mua (thanh khoản mỏng) hơn là bị bán mạnh.`}

${highVol.length
    ? `Đáng chú ý về thanh khoản: ${highVol.map((r) => `${r.shortName} (${fmtRatio(r.s.dollarVolRatio)})`).join(", ")} có giá trị giao dịch vượt trung bình 4 tuần — những điểm đến tiềm năng của dòng tiền cần theo dõi tiếp.`
    : `Không ngành nào có giá trị giao dịch vượt hẳn trung bình 4 tuần — tuần giao dịch trầm lắng, các tín hiệu luân chuyển cần thêm thời gian xác nhận.`}

## Theo dõi tuần tới

- **${topSector.symbol}**: kiểm chứng đà tăng — duy trì trên đáy tuần ${fmtPrice(topSector.s.weekLow)} kèm thanh khoản ổn định thì nhịp luân chuyển còn tiếp diễn.
- **${bottomSector.symbol}**: nếu tiếp tục giảm kèm giá trị giao dịch tăng, tín hiệu rút tiền sẽ chuyển thành phân phối rõ ràng.
`;
  await writeFile(`${OUT_DIR}/${reportDate}-sector-flow.md`, body);
  console.log(`[weekly] wrote ${reportDate}-sector-flow.md`);
}

// ---- 3. Ticker watchlist report ----
const trendPhrase = (s) => {
  if (s.pctWeek > 3) return "tăng mạnh nhất tuần trong nhóm theo dõi";
  if (s.pctWeek > 0.15) return s.pct4w > 0 ? "tiếp tục xu hướng tăng" : "hồi phục sau nhịp giảm";
  if (s.pctWeek < -3) return "chịu áp lực bán mạnh";
  if (s.pctWeek < -0.15) return s.pct4w < 0 ? "kéo dài nhịp điều chỉnh" : "điều chỉnh sau sóng tăng";
  return "đi ngang tích lũy";
};
{
  const highPhrase = (s) =>
    s.fromHigh13w > -2 ? "đang giao dịch sát đỉnh 13 tuần — cấu trúc giá thuộc nhóm mạnh nhất" :
    s.fromHigh13w > -10 ? `thấp hơn đỉnh 13 tuần ${fmtPct(s.fromHigh13w)}` :
    `vẫn cách xa đỉnh 13 tuần (${fmtPct(s.fromHigh13w)})`;
  const volPhrase = (s) =>
    s.dollarVolRatio >= 1.1 ? "Giá trị giao dịch cao hơn trung bình 4 tuần — biến động có dòng tiền xác nhận." :
    s.dollarVolRatio <= 0.75 ? "Giá trị giao dịch thấp hơn hẳn trung bình — biến động chưa có dòng tiền lớn đứng sau." :
    "Giá trị giao dịch quanh mức trung bình 4 tuần.";
  const watchNext = [...new Set([nearHigh, bestTicker, worstTicker])].slice(0, 3);

  const body = `${frontMatter({
    title: `Watchlist tuần ${range}`,
    type: "ticker",
    tickers: tickerRows.map((r) => r.symbol),
    excerpt: `${bestTicker.symbol} dẫn đầu watchlist (${fmtPct(bestTicker.s.pctWeek)}), ${worstTicker.symbol} yếu nhất (${fmtPct(worstTicker.s.pctWeek)}); ${nearHigh.symbol} có cấu trúc giá mạnh nhất nhóm.`,
  })}
## Bảng tổng hợp

Số liệu tuần giao dịch ${range}. "Từ đỉnh 13 tuần" = khoảng cách giá đóng tuần so với đỉnh 13 tuần gần nhất. Dòng tiền = giá trị giao dịch tuần so với trung bình 4 tuần trước.

| Mã | Đóng tuần | % tuần | % 4 tuần | Từ đỉnh 13 tuần | Dòng tiền/TB |
|---|---:|---:|---:|---:|---:|
${tickerRows.map((r) => `| ${r.symbol} | ${fmtPrice(r.s.close)} | ${fmtPct(r.s.pctWeek)} | ${fmtPct(r.s.pct4w)} | ${fmtPct(r.s.fromHigh13w)} | ${fmtRatio(r.s.dollarVolRatio)} |`).join("\n")}

## Phân tích từng mã

${tickerRows.map((r) => `### ${r.symbol} — ${r.name}

${r.symbol} ${trendPhrase(r.s)} với mức ${fmtPct(r.s.pctWeek)} (4 tuần: ${fmtPct(r.s.pct4w)}), ${highPhrase(r.s)}. ${volPhrase(r.s)} Vùng giá đáng chú ý: hỗ trợ ${fmtPrice(r.s.weekLow)} (đáy tuần), kháng cự ${fmtPrice(r.s.weekHigh)} (đỉnh tuần).${tech[r.symbol] ? ` ${techParagraph(tech[r.symbol])}` : ""}`).join("\n\n")}

## Đáng theo dõi tuần tới

${watchNext.map((r, i) => `${i + 1}. **${r.symbol}** — ${r === nearHigh ? `cấu trúc giá mạnh nhất nhóm (${fmtPct(r.s.fromHigh13w)} so với đỉnh 13 tuần); vượt ${fmtPrice(r.s.weekHigh)} kèm khối lượng là tín hiệu dẫn dắt mới` : r === bestTicker ? `dẫn đầu tuần (${fmtPct(r.s.pctWeek)}); giữ trên ${fmtPrice(r.s.weekLow)} thì đà tăng còn tiếp diễn` : `yếu nhất tuần (${fmtPct(r.s.pctWeek)}); mất đáy tuần ${fmtPrice(r.s.weekLow)} sẽ xác nhận tín hiệu phân phối ngắn hạn`}.`).join("\n")}
`;
  await writeFile(`${OUT_DIR}/${reportDate}-ticker-watch.md`, body);
  console.log(`[weekly] wrote ${reportDate}-ticker-watch.md`);
}

// ---- 4. Synthesized analysis article (blog post) ----
{
  const spyDir = dir(spy.pctWeek, "tăng", "đi ngang", "giảm");
  const breadthLine =
    stats.IWM && stats.IWM.pctWeek > spy.pctWeek
      ? "Điểm cộng của tuần là độ rộng: vốn hóa nhỏ tăng tốt hơn chỉ số chính, nghĩa là đà tăng không chỉ dựa vào vài cổ phiếu lớn."
      : "Đáng lưu ý là vốn hóa nhỏ vẫn yếu hơn chỉ số chính — thị trường tiếp tục phụ thuộc vào nhóm dẫn dắt vốn hóa lớn.";
  const flowStory = inflows.length
    ? `Câu chuyện dòng tiền tuần này nằm ở nhóm ${inflows.map((r) => `${r.shortName} (${r.symbol})`).join(", ")}: ${inflows.length > 1 ? "các ngành này" : "ngành này"} vừa vượt trội thị trường vừa có giá trị giao dịch từ mức trung bình trở lên — đặc điểm của dòng tiền tích lũy chủ động thay vì một nhịp bật kỹ thuật.`
    : `Tuần này không có ngành nào hút tiền một cách thuyết phục — ${topSector.shortName} dẫn đầu về giá (${fmtPct(topSector.s.pctWeek)}) nhưng thanh khoản chỉ đạt ${fmtRatio(topSector.s.dollarVolRatio)} trung bình, nên chưa thể gọi đây là một cuộc luân chuyển thực sự.`;
  const outflowStory = outflows.length
    ? ` Ngược lại, ${outflows.map((r) => `${r.shortName} (${r.symbol}, ${fmtPct(r.s.pctWeek)})`).join(", ")} giảm kèm giá trị giao dịch đáng kể — tiền đang chủ động rời nhóm này.`
    : "";

  const body = `${frontMatter({
    layout: "post.njk",
    title: `Phân tích thị trường tuần ${range}`,
    excerpt: `Thị trường ${tone}; ${topSector.shortName} dẫn dắt các ngành, ${bestTicker.symbol} nổi bật trong watchlist. Tổng hợp nhận định và các mốc cần quan sát tuần tới.`,
  })}
Tuần giao dịch ${range} khép lại với thị trường ${tone}: S&P 500 ${spyDir} ${fmtPct(spy.pctWeek)} (đóng tuần ${fmtPrice(spy.close)}), ${leader.symbol} dẫn đầu các chỉ số với ${fmtPct(leader.s.pctWeek)} còn ${laggard.symbol} xếp cuối với ${fmtPct(laggard.s.pctWeek)}. Đặt trong bức tranh 4 tuần, SPY đã ${dir(spy.pct4w, `tích lũy được ${fmtPct(spy.pct4w)}`, "gần như đi ngang", `mất ${fmtPct(spy.pct4w)}`, 0.5)}${spy.fromHigh13w > -2 ? " và đang đứng sát vùng đỉnh 13 tuần" : ""}. ${volNote} ${breadthLine}

## Góc nhìn kỹ thuật: các chỉ số chính

${["SPY", "QQQ"].filter((s) => tech[s]).map((s) => {
    const t = tech[s];
    const w = stats[s];
    return `### ${s} — ${s === "SPY" ? "S&P 500" : "NASDAQ-100"}

${techParagraph(t)}

Kịch bản tuần tới: giữ trên hỗ trợ ${fmtPrice(w.weekLow)} (đáy tuần)${t.trend === "up" ? ` và SMA20 (${fmtPrice(t.sma20)})` : ""} thì cấu trúc hiện tại còn nguyên; vượt kháng cự ${fmtPrice(Math.max(w.weekHigh, t.swingHigh4w))} kèm khối lượng cải thiện sẽ mở dư địa tăng mới${t.trend !== "down" ? `, ngược lại thủng ${fmtPrice(t.sma50)} (SMA50) là cảnh báo xu hướng trung hạn đầu tiên` : `; nếu tiếp tục yếu, hỗ trợ sâu hơn nằm ở đáy 13 tuần ${fmtPrice(t.low13w)}`}.`;
  }).join("\n\n")}

## Dòng tiền đang chảy về đâu?

Xếp hạng 11 nhóm ngành tuần này cho thấy **${topSector.shortName}** đứng đầu (${fmtPct(topSector.s.pctWeek)}) và **${bottomSector.shortName}** đứng cuối (${fmtPct(bottomSector.s.pctWeek)}); cơ cấu sức mạnh tương đối ${tilt}. ${flowStory}${outflowStory}

${tech[topSector.symbol] ? `Về mặt kỹ thuật, ${topSector.symbol} hiện ở ${trendText(tech[topSector.symbol])}; ${momentumText(tech[topSector.symbol])}. Nhà đầu tư muốn đi theo nhịp luân chuyển này nên chờ điểm vào hợp lý thay vì mua đuổi: ${planFor(tech[topSector.symbol]).entry}.` : ""}

## Phân tích watchlist: xu hướng và điểm mua/bán tham khảo

Trong watchlist, **${bestTicker.symbol}** dẫn đầu tuần với ${fmtPct(bestTicker.s.pctWeek)}, còn **${worstTicker.symbol}** yếu nhất với ${fmtPct(worstTicker.s.pctWeek)}. Dưới đây là góc nhìn kỹ thuật từng mã — vùng giá chỉ mang tính tham khảo theo chỉ báo, không phải khuyến nghị.

${tickerRows.map((r) => {
    const t = tech[r.symbol];
    if (!t) return `### ${r.symbol} — ${r.name}\n\nThiếu dữ liệu chỉ báo trong kỳ này.`;
    return `### ${r.symbol} — ${r.name}

Tuần qua ${fmtPct(r.s.pctWeek)} (4 tuần: ${fmtPct(r.s.pct4w)}), đóng tuần tại ${fmtPrice(r.s.close)}, cách đỉnh 13 tuần ${fmtPct(r.s.fromHigh13w)}. ${techParagraph(t)}

${planText(t)}`;
  }).join("\n\n")}

## Các mốc cần quan sát tuần tới

- **SPY**: giữ trên ${fmtPrice(spy.weekLow)} (đáy tuần) thì xu hướng hiện tại còn nguyên; vượt ${fmtPrice(spy.weekHigh)} mở dư địa tăng mới.
- **${topSector.symbol}**: sức mạnh của ${topSector.shortName} cần kéo dài sang tuần thứ hai để xác nhận luân chuyển thực sự.
- **${nearHigh.symbol}**: cấu trúc giá mạnh nhất watchlist (${fmtPct(nearHigh.s.fromHigh13w)} so với đỉnh 13 tuần) — phản ứng tại vùng đỉnh là "phép thử" quan trọng nhất của nhóm.
${outflows.length ? `- **${outflows[0].symbol}**: đang bị rút tiền chủ động — nếu tuần tới tiếp tục giảm kèm thanh khoản cao, nên tránh bắt đáy nhóm ${outflows[0].shortName}.` : ""}

---

*Số liệu chi tiết: [thị trường tuần](/reports/${reportDate}-weekly-market/) · [dòng tiền ngành](/reports/${reportDate}-sector-flow/) · [watchlist](/reports/${reportDate}-ticker-watch/). Bài viết được tạo tự động từ dữ liệu thị trường và chỉ báo kỹ thuật (SMA, RSI, MACD, ATR); mọi vùng giá chỉ mang tính tham khảo, không phải khuyến nghị đầu tư.*
`;
  await writeFile(`${POSTS_DIR}/${reportDate}-phan-tich-thi-truong-tuan.md`, body);
  console.log(`[weekly] wrote post ${reportDate}-phan-tich-thi-truong-tuan.md`);
}

if (missing.length) console.warn(`[weekly] done with missing symbols: ${missing.join(", ")}`);
