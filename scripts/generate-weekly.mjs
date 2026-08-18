// Generates the three weekly reports (market, sector flow, ticker watchlist)
// into src/reports/, using data from scripts/lib/marketdata.mjs.
// Run: node scripts/generate-weekly.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  fetchDaily, weeklyStats, fmtPct, fmtPrice, fmtRatio,
  weekRangeLabel, average,
} from "./lib/marketdata.mjs";

const OUT_DIR = "src/reports";
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
for (const symbol of symbols) {
  const rows = await fetchDaily(symbol, { today });
  const st = rows && weeklyStats(rows, today);
  if (st) stats[symbol] = st;
  else console.warn(`[weekly] skipping ${symbol}: no usable data`);
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

const frontMatter = (o) =>
  [
    "---",
    "layout: report.njk",
    `title: "${o.title}"`,
    `date: ${reportDate}`,
    `reportType: ${o.type}`,
    `tickers: [${o.tickers.join(", ")}]`,
    `excerpt: "${o.excerpt}"`,
    "---",
  ].join("\n");

const dir = (x, up, flat, down, eps = 0.15) => (x > eps ? up : x < -eps ? down : flat);

// ---- 1. Weekly market report ----
{
  const rows = watchlist.benchmarks
    .filter((b) => stats[b.symbol])
    .map((b) => ({ ...b, s: stats[b.symbol] }));
  const upCount = rows.filter((r) => r.s.pctWeek > 0).length;
  const leader = [...rows].sort((a, b) => b.s.pctWeek - a.s.pctWeek)[0];
  const laggard = [...rows].sort((a, b) => a.s.pctWeek - b.s.pctWeek)[0];
  const avgVolRatio = average(rows.map((r) => r.s.dollarVolRatio));

  const tone =
    upCount === rows.length ? "đồng thuận tăng trên cả bốn chỉ số" :
    upCount > rows.length / 2 ? "tăng trên diện rộng dù chưa đồng thuận" :
    upCount === rows.length / 2 ? "phân hóa, sắc xanh và sắc đỏ đan xen" :
    upCount > 0 ? "phân hóa với sắc đỏ chiếm ưu thế" : "giảm đồng loạt";
  const volNote =
    avgVolRatio >= 1.1 ? `Thanh khoản cao hơn trung bình 4 tuần (~${fmtRatio(avgVolRatio)}), cho thấy dòng tiền lớn đang tham gia tích cực.` :
    avgVolRatio <= 0.8 ? `Thanh khoản chỉ đạt ~${fmtRatio(avgVolRatio)} trung bình 4 tuần — biến động tuần này chưa được dòng tiền lớn xác nhận.` :
    `Thanh khoản xấp xỉ trung bình 4 tuần (~${fmtRatio(avgVolRatio)}).`;

  const note = (s) =>
    s.pctWeek > 1.5 ? "Tăng mạnh, dẫn dắt thị trường" :
    s.pctWeek > 0.15 ? (s.fromHigh13w > -2 ? "Tăng, giao dịch sát vùng đỉnh" : "Hồi phục") :
    s.pctWeek < -1.5 ? "Giảm mạnh" :
    s.pctWeek < -0.15 ? "Điều chỉnh nhẹ" : "Đi ngang tích lũy";

  const sectorRows = watchlist.sectors.filter((x) => stats[x.symbol]);
  const bestSector = [...sectorRows].sort((a, b) => stats[b.symbol].pctWeek - stats[a.symbol].pctWeek)[0];
  const worstSector = [...sectorRows].sort((a, b) => stats[a.symbol].pctWeek - stats[b.symbol].pctWeek)[0];
  const iwm = stats.IWM;

  const body = `${frontMatter({
    title: `Thị trường tuần ${range}`,
    type: "weekly",
    tickers: rows.map((r) => r.symbol),
    excerpt: `S&P 500 ${fmtPct(spy.pctWeek)} trong tuần; ${leader.name.split(" (")[0]} dẫn dắt (${fmtPct(leader.s.pctWeek)}); tính 4 tuần SPY ${fmtPct(spy.pct4w)}.`,
  })}
## Tổng quan

Tuần giao dịch ${range} khép lại với thị trường ${tone}. ${leader.name.split(" (")[0]} (${leader.symbol}) ${dir(leader.s.pctWeek, `tăng tốt nhất với ${fmtPct(leader.s.pctWeek)}`, `gần như đi ngang (${fmtPct(leader.s.pctWeek)})`, `giảm ít nhất (${fmtPct(leader.s.pctWeek)})`)}, trong khi ${laggard.symbol} ${dir(laggard.s.pctWeek, "vẫn giữ được sắc xanh", "đi ngang", `yếu nhất với ${fmtPct(laggard.s.pctWeek)}`)}. Nhìn rộng hơn, S&P 500 (SPY) đã ${dir(spy.pct4w, `tăng ${fmtPct(spy.pct4w)}`, "gần như không đổi", `giảm ${fmtPct(spy.pct4w)}`, 0.5)} trong 4 tuần gần nhất${spy.fromHigh13w > -2 ? " và đang giao dịch sát vùng đỉnh 13 tuần" : spy.fromHigh13w < -8 ? ` và vẫn thấp hơn đỉnh 13 tuần ${fmtPct(spy.fromHigh13w)}` : ""}. ${volNote}

## Bảng chỉ số

| Chỉ số (ETF) | Đóng tuần | % tuần | % 4 tuần | KL/TB 4 tuần | Nhận xét |
|---|---:|---:|---:|---:|---|
${rows.map((r) => `| ${r.name} | ${fmtPrice(r.s.close)} | ${fmtPct(r.s.pctWeek)} | ${fmtPct(r.s.pct4w)} | ${fmtRatio(r.s.dollarVolRatio)} | ${note(r.s)} |`).join("\n")}

## Điểm nhấn

- **Ngành mạnh nhất**: ${bestSector.name.split(" (")[0]} (${bestSector.symbol}) ${fmtPct(stats[bestSector.symbol].pctWeek)}; **yếu nhất**: ${worstSector.name.split(" (")[0]} (${worstSector.symbol}) ${fmtPct(stats[worstSector.symbol].pctWeek)} — chi tiết trong báo cáo dòng tiền ngành cùng kỳ.
- **Độ rộng thị trường**: vốn hóa nhỏ (IWM ${fmtPct(iwm?.pctWeek ?? NaN)}) ${iwm && iwm.pctWeek > spy.pctWeek ? "tăng tốt hơn SPY — tín hiệu độ rộng tích cực" : "yếu hơn SPY — đà tăng vẫn phụ thuộc nhóm vốn hóa lớn"}.
- **Thanh khoản**: ${volNote}

## Tuần tới

- SPY: hỗ trợ gần nhất ${fmtPrice(spy.weekLow)} (đáy tuần), kháng cự ${fmtPrice(spy.weekHigh)} (đỉnh tuần) — mất hỗ trợ là tín hiệu điều chỉnh ngắn hạn đầu tiên.
- QQQ: quan sát vùng ${fmtPrice(stats.QQQ?.weekLow ?? NaN)}–${fmtPrice(stats.QQQ?.weekHigh ?? NaN)}; vượt đỉnh tuần kèm khối lượng cải thiện sẽ mở dư địa tăng mới cho nhóm công nghệ.
- Theo dõi liệu sức mạnh của ${bestSector.name.split(" (")[0]} (${bestSector.symbol}) có duy trì sang tuần thứ hai để xác nhận xu hướng luân chuyển.
`;
  await writeFile(`${OUT_DIR}/${reportDate}-weekly-market.md`, body);
  console.log(`[weekly] wrote ${reportDate}-weekly-market.md`);
}

// ---- 2. Sector money flow report ----
{
  const rows = watchlist.sectors
    .filter((x) => stats[x.symbol])
    .map((x) => {
      const s = stats[x.symbol];
      const rs = s.pctWeek - spy.pctWeek;
      const label =
        rs > 0 && s.pctWeek > 0 && s.dollarVolRatio >= 1 ? "Hút tiền" :
        s.pctWeek < 0 && s.dollarVolRatio >= 0.9 ? "Bị rút tiền" :
        rs > 0 && s.pctWeek > 0 ? "Tăng, thanh khoản mỏng" :
        s.pctWeek < 0 ? "Yếu, thanh khoản mỏng" : "Trung tính";
      return { ...x, s, rs, label, shortName: x.name.split(" (")[0] };
    })
    .sort((a, b) => b.s.pctWeek - a.s.pctWeek);

  const top = rows[0];
  const bottom = rows.at(-1);
  const riskOnRs = average(rows.filter((r) => RISK_ON.includes(r.symbol)).map((r) => r.rs));
  const defRs = average(rows.filter((r) => DEFENSIVE.includes(r.symbol)).map((r) => r.rs));
  const tilt =
    riskOnRs > defRs + 0.3 ? "nghiêng rõ về **risk-on**: nhóm Công nghệ / Tiêu dùng không thiết yếu / Tài chính mạnh hơn nhóm phòng thủ" :
    defRs > riskOnRs + 0.3 ? "nghiêng về **phòng thủ**: Tiện ích / Tiêu dùng thiết yếu / Y tế mạnh hơn nhóm risk-on — một bộ phận dòng tiền đang hạ khẩu vị rủi ro" :
    "khá cân bằng giữa nhóm risk-on và nhóm phòng thủ";
  const inflows = rows.filter((r) => r.label === "Hút tiền");
  const outflows = rows.filter((r) => r.label === "Bị rút tiền");
  const highVol = rows.filter((r) => r.s.dollarVolRatio >= 1.05);

  const body = `${frontMatter({
    title: `Dòng tiền ngành tuần ${range}`,
    type: "sector-flow",
    tickers: rows.map((r) => r.symbol),
    excerpt: `${top.name} dẫn đầu (${fmtPct(top.s.pctWeek)}), ${bottom.name} yếu nhất (${fmtPct(bottom.s.pctWeek)}); cơ cấu dòng tiền ${riskOnRs > defRs ? "nghiêng risk-on" : "nghiêng phòng thủ"}.`,
  })}
## Bức tranh chung

Trong tuần ${range}, so với mức ${fmtPct(spy.pctWeek)} của SPY, dòng tiền dồn mạnh nhất vào **${top.shortName}** (${top.symbol} ${fmtPct(top.s.pctWeek)}) và rời khỏi **${bottom.shortName}** (${bottom.symbol} ${fmtPct(bottom.s.pctWeek)}). Cơ cấu sức mạnh tương đối tuần này ${tilt}.

## Bảng xếp hạng

RS = sức mạnh tương đối so với SPY (${fmtPct(spy.pctWeek)}). Dòng tiền = giá trị giao dịch tuần (giá × khối lượng) so với trung bình 4 tuần trước.

| Ngành (ETF) | % tuần | RS so SPY | Dòng tiền/TB 4 tuần | Phân loại |
|---|---:|---:|---:|---|
${rows.map((r) => `| ${r.name} (${r.symbol}) | ${fmtPct(r.s.pctWeek)} | ${fmtPct(r.rs)} | ${fmtRatio(r.s.dollarVolRatio)} | ${r.label} |`).join("\n")}

## Phân tích luân chuyển

${inflows.length
    ? `Nhóm hút tiền rõ nhất tuần này: ${inflows.map((r) => `**${r.shortName}** (${r.symbol}, ${fmtPct(r.s.pctWeek)}, dòng tiền ${fmtRatio(r.s.dollarVolRatio)})`).join(", ")} — vừa vượt trội thị trường vừa có giá trị giao dịch từ mức trung bình trở lên, tín hiệu tích lũy chủ động.`
    : `Không ngành nào hội đủ cả hai điều kiện hút tiền (vượt SPY kèm giá trị giao dịch trên trung bình) — sự vượt trội của ${top.symbol} diễn ra trên nền thanh khoản ${fmtRatio(top.s.dollarVolRatio)}, cần thêm xác nhận.`}

${outflows.length
    ? `Ở chiều ngược lại, ${outflows.map((r) => `**${r.shortName}** (${r.symbol}, ${fmtPct(r.s.pctWeek)}, dòng tiền ${fmtRatio(r.s.dollarVolRatio)})`).join(", ")} giảm giá với giá trị giao dịch đáng kể — dấu hiệu phân phối chủ động thay vì chỉ thiếu người mua.`
    : `Chiều bán không có ngành nào bị rút tiền chủ động rõ rệt — các ngành giảm giá chủ yếu do thiếu lực mua (thanh khoản mỏng) hơn là bị bán mạnh.`}

${highVol.length
    ? `Đáng chú ý về thanh khoản: ${highVol.map((r) => `${r.shortName} (${fmtRatio(r.s.dollarVolRatio)})`).join(", ")} có giá trị giao dịch vượt trung bình 4 tuần — những điểm đến tiềm năng của dòng tiền cần theo dõi tiếp.`
    : `Không ngành nào có giá trị giao dịch vượt hẳn trung bình 4 tuần — tuần giao dịch trầm lắng, các tín hiệu luân chuyển cần thêm thời gian xác nhận.`}

## Theo dõi tuần tới

- **${top.symbol}**: kiểm chứng đà tăng — duy trì trên đáy tuần ${fmtPrice(top.s.weekLow)} kèm thanh khoản ổn định thì nhịp luân chuyển còn tiếp diễn.
- **${bottom.symbol}**: nếu tiếp tục giảm kèm giá trị giao dịch tăng, tín hiệu rút tiền sẽ chuyển thành phân phối rõ ràng.
`;
  await writeFile(`${OUT_DIR}/${reportDate}-sector-flow.md`, body);
  console.log(`[weekly] wrote ${reportDate}-sector-flow.md`);
}

// ---- 3. Ticker watchlist report ----
{
  const rows = watchlist.tickers
    .filter((t) => stats[t.symbol])
    .map((t) => ({ ...t, s: stats[t.symbol] }))
    .sort((a, b) => b.s.pctWeek - a.s.pctWeek);

  const trendPhrase = (s) => {
    if (s.pctWeek > 3) return "tăng mạnh nhất tuần trong nhóm theo dõi";
    if (s.pctWeek > 0.15) return s.pct4w > 0 ? "tiếp tục xu hướng tăng" : "hồi phục sau nhịp giảm";
    if (s.pctWeek < -3) return "chịu áp lực bán mạnh";
    if (s.pctWeek < -0.15) return s.pct4w < 0 ? "kéo dài nhịp điều chỉnh" : "điều chỉnh sau sóng tăng";
    return "đi ngang tích lũy";
  };
  const highPhrase = (s) =>
    s.fromHigh13w > -2 ? "đang giao dịch sát đỉnh 13 tuần — cấu trúc giá thuộc nhóm mạnh nhất" :
    s.fromHigh13w > -10 ? `thấp hơn đỉnh 13 tuần ${fmtPct(s.fromHigh13w)}` :
    `vẫn cách xa đỉnh 13 tuần (${fmtPct(s.fromHigh13w)})`;
  const volPhrase = (s) =>
    s.dollarVolRatio >= 1.1 ? "Giá trị giao dịch cao hơn trung bình 4 tuần — biến động có dòng tiền xác nhận." :
    s.dollarVolRatio <= 0.75 ? "Giá trị giao dịch thấp hơn hẳn trung bình — biến động chưa có dòng tiền lớn đứng sau." :
    "Giá trị giao dịch quanh mức trung bình 4 tuần.";

  const best = rows[0];
  const worst = rows.at(-1);
  const nearHigh = [...rows].sort((a, b) => b.s.fromHigh13w - a.s.fromHigh13w)[0];
  const watchNext = [...new Set([nearHigh, best, worst])].slice(0, 3);

  const body = `${frontMatter({
    title: `Watchlist tuần ${range}`,
    type: "ticker",
    tickers: rows.map((r) => r.symbol),
    excerpt: `${best.symbol} dẫn đầu watchlist (${fmtPct(best.s.pctWeek)}), ${worst.symbol} yếu nhất (${fmtPct(worst.s.pctWeek)}); ${nearHigh.symbol} có cấu trúc giá mạnh nhất nhóm.`,
  })}
## Bảng tổng hợp

Số liệu tuần giao dịch ${range}. "Từ đỉnh 13 tuần" = khoảng cách giá đóng tuần so với đỉnh 13 tuần gần nhất. Dòng tiền = giá trị giao dịch tuần so với trung bình 4 tuần trước.

| Mã | Đóng tuần | % tuần | % 4 tuần | Từ đỉnh 13 tuần | Dòng tiền/TB |
|---|---:|---:|---:|---:|---:|
${rows.map((r) => `| ${r.symbol} | ${fmtPrice(r.s.close)} | ${fmtPct(r.s.pctWeek)} | ${fmtPct(r.s.pct4w)} | ${fmtPct(r.s.fromHigh13w)} | ${fmtRatio(r.s.dollarVolRatio)} |`).join("\n")}

## Phân tích từng mã

${rows.map((r) => `### ${r.symbol} — ${r.name}

${r.symbol} ${trendPhrase(r.s)} với mức ${fmtPct(r.s.pctWeek)} (4 tuần: ${fmtPct(r.s.pct4w)}), ${highPhrase(r.s)}. ${volPhrase(r.s)} Vùng giá đáng chú ý: hỗ trợ ${fmtPrice(r.s.weekLow)} (đáy tuần), kháng cự ${fmtPrice(r.s.weekHigh)} (đỉnh tuần).`).join("\n\n")}

## Đáng theo dõi tuần tới

${watchNext.map((r, i) => `${i + 1}. **${r.symbol}** — ${r === nearHigh ? `cấu trúc giá mạnh nhất nhóm (${fmtPct(r.s.fromHigh13w)} so với đỉnh 13 tuần); vượt ${fmtPrice(r.s.weekHigh)} kèm khối lượng là tín hiệu dẫn dắt mới` : r === best ? `dẫn đầu tuần (${fmtPct(r.s.pctWeek)}); giữ trên ${fmtPrice(r.s.weekLow)} thì đà tăng còn tiếp diễn` : `yếu nhất tuần (${fmtPct(r.s.pctWeek)}); mất đáy tuần ${fmtPrice(r.s.weekLow)} sẽ xác nhận tín hiệu phân phối ngắn hạn`}.`).join("\n")}
`;
  await writeFile(`${OUT_DIR}/${reportDate}-ticker-watch.md`, body);
  console.log(`[weekly] wrote ${reportDate}-ticker-watch.md`);
}

if (missing.length) console.warn(`[weekly] done with missing symbols: ${missing.join(", ")}`);
