// Market data layer for the automated report generators.
// Keyless EOD sources: Stooq (primary), Yahoo Finance chart API (fallback).
// Set REPORTS_DATA_DIR to a directory of <SYMBOL>.csv files (Stooq format)
// to run offline, e.g. in tests.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FETCH_DELAY_MS = 300;
const RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseStooqCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !/^date,open/i.test(lines[0])) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const [date, open, high, low, close, volume] = line.split(",");
    const c = Number(close);
    if (!date || !Number.isFinite(c)) continue;
    rows.push({
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: c,
      volume: Number(volume) || 0,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows;
}

async function fetchWithRetry(url, options = {}) {
  let lastErr;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

async function fetchStooq(symbol, fromDate) {
  const s = `${symbol.toLowerCase()}.us`;
  const d1 = fromDate.replaceAll("-", "");
  const url = `https://stooq.com/q/d/l/?s=${s}&i=d&d1=${d1}`;
  const res = await fetchWithRetry(url);
  const rows = parseStooqCsv(await res.text());
  if (!rows.length) throw new Error(`Stooq: no data for ${symbol}`);
  return rows;
}

async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y`;
  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": "Mozilla/5.0 (report-generator)" },
  });
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) throw new Error(`Yahoo: no data for ${symbol}`);
  const rows = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const close = quote.close?.[i];
    if (!Number.isFinite(close)) continue;
    rows.push({
      date: new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10),
      open: quote.open?.[i] ?? close,
      high: quote.high?.[i] ?? close,
      low: quote.low?.[i] ?? close,
      close,
      volume: quote.volume?.[i] ?? 0,
    });
  }
  if (!rows.length) throw new Error(`Yahoo: empty series for ${symbol}`);
  return rows;
}

// Returns daily OHLCV rows sorted ascending by date, or null if every source failed.
export async function fetchDaily(symbol, { lookbackDays = 500, today = new Date() } = {}) {
  if (process.env.REPORTS_DATA_DIR) {
    const file = join(process.env.REPORTS_DATA_DIR, `${symbol}.csv`);
    try {
      return parseStooqCsv(await readFile(file, "utf8"));
    } catch {
      return null;
    }
  }
  const from = new Date(today.getTime() - lookbackDays * 86400_000)
    .toISOString()
    .slice(0, 10);
  try {
    return await fetchStooq(symbol, from);
  } catch (err) {
    console.warn(`[data] Stooq failed for ${symbol} (${err.message}), trying Yahoo`);
  } finally {
    await sleep(FETCH_DELAY_MS);
  }
  try {
    return await fetchYahoo(symbol);
  } catch (err) {
    console.warn(`[data] Yahoo failed for ${symbol} (${err.message})`);
    return null;
  }
}

// ---- Aggregation ----

// Monday (UTC) of the week containing the given YYYY-MM-DD date.
export function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// Groups daily rows into calendar weeks (Mon-Sun). Ascending order.
export function toWeekly(rows) {
  const weeks = new Map();
  for (const r of rows) {
    const key = mondayOf(r.date);
    let w = weeks.get(key);
    if (!w) {
      w = { weekStart: key, firstDate: r.date, lastDate: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: 0 };
      weeks.set(key, w);
    }
    w.lastDate = r.date;
    w.high = Math.max(w.high, r.high);
    w.low = Math.min(w.low, r.low);
    w.close = r.close;
    w.volume += r.volume;
  }
  return [...weeks.values()];
}

// Groups daily rows into calendar months. Ascending order.
export function toMonthly(rows) {
  const months = new Map();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    let m = months.get(key);
    if (!m) {
      m = { month: key, firstDate: r.date, lastDate: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: 0 };
      months.set(key, m);
    }
    m.lastDate = r.date;
    m.high = Math.max(m.high, r.high);
    m.low = Math.min(m.low, r.low);
    m.close = r.close;
    m.volume += r.volume;
  }
  return [...months.values()];
}

// Weeks strictly before the week containing `today` (i.e. fully completed).
export function completedWeeks(weekly, today = new Date()) {
  const currentMonday = mondayOf(today.toISOString().slice(0, 10));
  return weekly.filter((w) => w.weekStart < currentMonday);
}

// Months strictly before the month containing `today`.
export function completedMonths(monthly, today = new Date()) {
  const currentMonth = today.toISOString().slice(0, 7);
  return monthly.filter((m) => m.month < currentMonth);
}

// ---- Math & formatting ----

export const pctChange = (now, then) => (then ? (now / then - 1) * 100 : NaN);

export function fmtPct(x, digits = 2) {
  if (!Number.isFinite(x)) return "n/a";
  const s = Math.abs(x).toFixed(digits);
  return x < 0 ? `−${s}%` : `+${s}%`;
}

export function fmtPrice(x) {
  if (!Number.isFinite(x)) return "n/a";
  return x >= 1000 ? x.toLocaleString("en-US", { maximumFractionDigits: 2 }) : x.toFixed(2);
}

export function fmtRatio(x) {
  return Number.isFinite(x) ? `${x.toFixed(2)}×` : "n/a";
}

export const vnDate = (dateStr) => {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
};

// "10–14/08/2026" for a week given its first and last trading dates.
export function weekRangeLabel(firstDate, lastDate) {
  const [, m1, d1] = firstDate.split("-");
  const [y2, m2, d2] = lastDate.split("-");
  return m1 === m2 ? `${d1}–${d2}/${m2}/${y2}` : `${d1}/${m1}–${d2}/${m2}/${y2}`;
}

export function average(xs) {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

// Stats for the most recent completed week of a symbol.
// Needs >= 6 completed weeks for the ratios; returns null when data is too thin.
export function weeklyStats(dailyRows, today = new Date()) {
  const weeks = completedWeeks(toWeekly(dailyRows), today);
  if (weeks.length < 6) return null;
  const w = weeks.at(-1);
  const prev = weeks.at(-2);
  const w4 = weeks.at(-5);
  const dollarVol = (x) => x.close * x.volume;
  const prior4 = weeks.slice(-5, -1);
  const high13 = Math.max(...weeks.slice(-13).map((x) => x.high));
  return {
    week: w,
    close: w.close,
    pctWeek: pctChange(w.close, prev.close),
    pct4w: pctChange(w.close, w4.close),
    fromHigh13w: pctChange(w.close, high13),
    dollarVolRatio: dollarVol(w) / average(prior4.map(dollarVol)),
    weekHigh: w.high,
    weekLow: w.low,
  };
}
