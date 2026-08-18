// Instant ticker lookup for /lookup/ with a TradingView-style candlestick
// chart (lightweight-charts): daily data for 6mo-10y views plus intraday
// intervals (5m/15m/1h) for the short timeframes, and a detailed written
// multi-timeframe analysis. Primary source: Yahoo Finance chart API;
// fallback for tracked symbols: /api/snapshot.json (daily only).
(function () {
  "use strict";

  var form = document.getElementById("lookup-form");
  var input = document.getElementById("lookup-input");
  var result = document.getElementById("lookup-result");
  if (!form || !input || !result) return;

  // interval "1d" ranges reuse the 10y daily dataset and only move the
  // visible window; intraday ranges fetch their own dataset on demand.
  // TradingView-style range labels. interval "1d" entries reuse the shared
  // 10y daily dataset and only move the visible window.
  var RANGES = [
    { label: "1D", interval: "5m", range: "1d" },
    { label: "5D", interval: "15m", range: "5d" },
    { label: "1M", interval: "1h", range: "1mo" },
    { label: "3M", interval: "1h", range: "3mo" },
    { label: "6M", interval: "1d", months: 6 },
    { label: "YTD", interval: "1d", ytd: true },
    { label: "1Y", interval: "1d", months: 12 },
    { label: "5Y", interval: "1d", months: 60 },
    { label: "10Y", interval: "1d", months: 120 },
  ];
  var DEFAULT_LABEL = "1Y";

  var fmt = {
    price: function (x) {
      if (!isFinite(x)) return "n/a";
      return x >= 1000
        ? x.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : x.toFixed(2);
    },
    pct: function (x, digits) {
      if (!isFinite(x)) return "n/a";
      var s = Math.abs(x).toFixed(digits == null ? 2 : digits) + "%";
      return x < 0 ? "−" + s : "+" + s;
    },
    date: function (iso) {
      var p = iso.split("-");
      return p[2] + "/" + p[1] + "/" + p[0];
    },
  };

  // ---- Indicator math ----

  function sma(values, n) {
    if (values.length < n) return NaN;
    var s = 0;
    for (var i = values.length - n; i < values.length; i++) s += values[i];
    return s / n;
  }

  function smaSeriesArr(candles, n) {
    var out = [], sum = 0;
    for (var i = 0; i < candles.length; i++) {
      sum += candles[i].c;
      if (i >= n) sum -= candles[i - n].c;
      if (i >= n - 1) out.push({ time: candles[i].time, value: sum / n });
    }
    return out;
  }

  function rsi(closes, n) {
    n = n || 14;
    if (closes.length < n + 1) return NaN;
    var gain = 0, loss = 0, d, i;
    for (i = 1; i <= n; i++) {
      d = closes[i] - closes[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    gain /= n; loss /= n;
    for (i = n + 1; i < closes.length; i++) {
      d = closes[i] - closes[i - 1];
      gain = (gain * (n - 1) + Math.max(d, 0)) / n;
      loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    }
    if (loss === 0) return 100;
    return 100 - 100 / (1 + gain / loss);
  }

  function pctChange(now, then) {
    return then ? (now / then - 1) * 100 : NaN;
  }

  function emaArr(values, n) {
    if (values.length < n) return [];
    var k = 2 / (n + 1), out = [], sum = 0, i;
    for (i = 0; i < n; i++) sum += values[i];
    out.push(sum / n);
    for (i = n; i < values.length; i++) out.push(values[i] * k + out[out.length - 1] * (1 - k));
    return out;
  }

  function macdLast(closes) {
    if (closes.length < 36) return null;
    var f = emaArr(closes, 12), s = emaArr(closes, 26);
    var line = [];
    for (var i = 0; i < s.length; i++) line.push(f[i + 14] - s[i]);
    var sig = emaArr(line, 9);
    var hist = [];
    for (var j = 0; j < sig.length; j++) hist.push(line[j + 8] - sig[j]);
    return { hist: hist[hist.length - 1], prevHist: hist.length > 1 ? hist[hist.length - 2] : NaN };
  }

  function atrFromSeries(series, n) {
    n = n || 14;
    var rows = series.slice(-80);
    if (rows.length < n + 1 || typeof rows[0].h !== "number") return NaN;
    var trs = [], i;
    for (i = 1; i < rows.length; i++) {
      trs.push(Math.max(
        rows[i].h - rows[i].l,
        Math.abs(rows[i].h - rows[i - 1].c),
        Math.abs(rows[i].l - rows[i - 1].c)
      ));
    }
    var a = 0;
    for (i = 0; i < n; i++) a += trs[i];
    a /= n;
    for (i = n; i < trs.length; i++) a = (a * (n - 1) + trs[i]) / n;
    return a;
  }

  function closesPer(series, keyFn) {
    var out = [], lastKey = null;
    for (var i = 0; i < series.length; i++) {
      var k = keyFn(series[i].d);
      if (k !== lastKey) { out.push(series[i].c); lastKey = k; }
      else out[out.length - 1] = series[i].c;
    }
    return out;
  }

  function weekKey(d) {
    var dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  }

  function monthKey(d) { return d.slice(0, 7); }

  function tfState(closes, fast, slow) {
    var st = { trend: null, rsi: NaN, macd: null, fast: NaN, slow: NaN };
    if (closes.length >= slow) {
      var c = closes[closes.length - 1], f = sma(closes, fast), s = sma(closes, slow);
      st.trend = c > f && f > s ? "up" : c < f && f < s ? "down" : "side";
      st.fast = f; st.slow = s;
    }
    if (closes.length >= 15) st.rsi = rsi(closes, 14);
    st.macd = macdLast(closes);
    return st;
  }

  // ---- Data sources ----
  // Normalized item: { time: <lwc time>, d: "YYYY-MM-DD", o,h,l,c,v }.

  function yahooUrl(host, symbol, interval, range) {
    return "https://" + host + ".finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) + "?interval=" + interval + "&range=" + range +
      "&events=div%2Csplit%2Cearn";
  }

  function fetchWithTimeout(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(
      function (res) { if (timer) clearTimeout(timer); return res; },
      function (err) { if (timer) clearTimeout(timer); throw err; }
    );
  }

  var dataCache = {};

  function fetchYahoo(symbol, interval, range) {
    var key = symbol + "|" + interval + "|" + range;
    if (dataCache[key]) return Promise.resolve(dataCache[key]);
    var intraday = interval !== "1d";
    // Preferred source: the site's own Cloudflare Worker proxy (see
    // workers/README.md); public CORS proxies remain as fallbacks.
    var proxy = (typeof window !== "undefined" && window.MARKET_PROXY ? String(window.MARKET_PROXY) : "").replace(/\/+$/, "");
    var urls = [];
    if (proxy) {
      urls.push(proxy + "/chart?symbol=" + encodeURIComponent(symbol) + "&interval=" + interval + "&range=" + range);
    }
    urls.push(
      yahooUrl("query1", symbol, interval, range),
      "https://corsproxy.io/?url=" + encodeURIComponent(yahooUrl("query1", symbol, interval, range)),
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(yahooUrl("query2", symbol, interval, range))
    );
    var attempt = function (idx) {
      if (idx >= urls.length) return Promise.reject(new Error("yahoo unreachable"));
      return fetchWithTimeout(urls[idx], 8000).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (json) {
        var r = json && json.chart && json.chart.result && json.chart.result[0];
        var q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
        if (!r || !r.timestamp || !q) throw new Error("no data");
        var series = [];
        for (var i = 0; i < r.timestamp.length; i++) {
          var c = q.close && q.close[i];
          if (typeof c !== "number" || !isFinite(c)) continue;
          series.push({
            time: intraday ? r.timestamp[i] : new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
            d: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
            o: typeof q.open[i] === "number" ? q.open[i] : c,
            h: typeof q.high[i] === "number" ? q.high[i] : c,
            l: typeof q.low[i] === "number" ? q.low[i] : c,
            c: c,
            v: typeof q.volume[i] === "number" ? q.volume[i] : 0,
          });
        }
        if (series.length < (intraday ? 10 : 30)) throw new Error("series too short");
        var meta = r.meta || {};
        var ev = r.events || {};
        var toList = function (obj) {
          return obj ? Object.keys(obj).map(function (k) { return obj[k]; }) : [];
        };
        var evDate = function (x) {
          return new Date((x.date || x.timestamp || 0) * 1000).toISOString().slice(0, 10);
        };
        var data = {
          source: "Yahoo Finance",
          live: true,
          intraday: intraday,
          name: meta.longName || meta.shortName || symbol,
          currency: meta.currency || "USD",
          series: series,
          dividends: toList(ev.dividends)
            .filter(function (d) { return isFinite(d.amount); })
            .map(function (d) { return { date: evDate(d), amount: d.amount }; })
            .sort(function (x, y) { return x.date < y.date ? -1 : 1; }),
          splits: toList(ev.splits)
            .map(function (s) {
              return { date: evDate(s), ratio: s.splitRatio || (s.numerator + ":" + s.denominator) };
            })
            .sort(function (x, y) { return x.date < y.date ? -1 : 1; }),
          earnings: toList(ev.earnings)
            .map(evDate)
            .sort(),
        };
        dataCache[key] = data;
        return data;
      }).catch(function () { return attempt(idx + 1); });
    };
    return attempt(0);
  }

  var snapshotPromise = null;
  function fetchSnapshot(symbol) {
    if (!snapshotPromise) {
      snapshotPromise = fetch("/api/snapshot.json").then(function (res) {
        if (!res.ok) throw new Error("no snapshot");
        return res.json();
      });
    }
    return snapshotPromise.then(function (snap) {
      var entry = snap.symbols && snap.symbols[symbol];
      if (!entry) throw new Error("symbol not in snapshot");
      return {
        source: "dữ liệu cuối tuần của site (cập nhật " + fmt.date(snap.updated) + ")",
        live: false,
        intraday: false,
        name: entry.name,
        currency: "USD",
        series: entry.series.map(function (p) {
          p.time = p.d;
          return p;
        }),
      };
    });
  }

  // ---- Chart engine: main pane + optional RSI/MACD panes, toggleable
  // indicators, synced time scales, fullscreen support ----

  var charts = [];
  var mainChart = null;
  var futureTail = null; // future time slots when the Ichimoku cloud projects ahead
  var view = { series: null, intraday: false, rangeLabel: DEFAULT_LABEL };
  var IND_DEFAULTS = {
    sma20: true, sma50: true, sma200: false, ema20: false, bb: false,
    sr: false, ichi: false, plan: false, vol: true, rsi: false, stoch: false, macd: false,
  };
  var PARAM_DEFAULTS = {
    sma1: 20, sma2: 50, sma3: 200, ema: 20, bbP: 20, bbK: 2,
    rsi: 14, macdF: 12, macdS: 26, macdSig: 9,
    stochK: 14, stochKS: 3, stochD: 3,
    ichiT: 9, ichiK: 26, ichiB: 52,
    srWin: 10, srMax: 6,
  };
  var params = (function () {
    try {
      var s = localStorage.getItem("lookupIndParams");
      if (s) {
        var parsed = JSON.parse(s), out = {};
        for (var k in PARAM_DEFAULTS) {
          var v = Number(parsed[k]);
          out[k] = isFinite(v) && v > 0 ? v : PARAM_DEFAULTS[k];
        }
        return out;
      }
    } catch (e) { /* ignore */ }
    var copy = {};
    for (var k2 in PARAM_DEFAULTS) copy[k2] = PARAM_DEFAULTS[k2];
    return copy;
  })();
  function saveParams() {
    try { localStorage.setItem("lookupIndParams", JSON.stringify(params)); } catch (e) { /* ignore */ }
  }
  var SETTING_GROUPS = [
    { label: "SMA (3 đường)", keys: ["sma1", "sma2", "sma3"] },
    { label: "EMA", keys: ["ema"] },
    { label: "Bollinger (chu kỳ, độ lệch)", keys: ["bbP", "bbK"] },
    { label: "RSI", keys: ["rsi"] },
    { label: "MACD (nhanh, chậm, signal)", keys: ["macdF", "macdS", "macdSig"] },
    { label: "Stochastic (%K, mượt K, %D)", keys: ["stochK", "stochKS", "stochD"] },
    { label: "Ichimoku (Tenkan, Kijun, Senkou B)", keys: ["ichiT", "ichiK", "ichiB"] },
    { label: "S/R (độ rộng pivot, số vạch tối đa)", keys: ["srWin", "srMax"] },
  ];
  function indLabel(key) {
    switch (key) {
      case "sma20": return "SMA " + params.sma1;
      case "sma50": return "SMA " + params.sma2;
      case "sma200": return "SMA " + params.sma3;
      case "ema20": return "EMA " + params.ema;
      case "bb": return "BB(" + params.bbP + "," + params.bbK + ")";
      case "sr": return "S/R";
      case "ichi": return "Ichimoku";
      case "plan": return "Entry/SL";
      case "vol": return "Volume";
      case "rsi": return "RSI " + params.rsi;
      case "stoch": return "Stoch(" + params.stochK + "," + params.stochKS + "," + params.stochD + ")";
      case "macd": return "MACD(" + params.macdF + "," + params.macdS + "," + params.macdSig + ")";
      default: return key;
    }
  }
  var IND_META = [
    { key: "sma20", color: "#e6a23c" },
    { key: "sma50", color: "#5b8def" },
    { key: "sma200", color: "#b06fd8" },
    { key: "ema20", color: "#2aa9a9" },
    { key: "bb", color: "#9a9aa2" },
    { key: "sr", color: "#c9a227" },
    { key: "ichi", color: "#1a7f4b" },
    { key: "plan", color: "" },
    { key: "vol", color: "" },
    { key: "rsi", color: "#e6a23c" },
    { key: "stoch", color: "#2aa9a9" },
    { key: "macd", color: "#5b8def" },
  ];
  var indicators = (function () {
    try {
      var s = localStorage.getItem("lookupIndicators");
      if (s) {
        var parsed = JSON.parse(s);
        var out = {};
        for (var k in IND_DEFAULTS) out[k] = typeof parsed[k] === "boolean" ? parsed[k] : IND_DEFAULTS[k];
        return out;
      }
    } catch (e) { /* ignore */ }
    var copy = {};
    for (var k2 in IND_DEFAULTS) copy[k2] = IND_DEFAULTS[k2];
    return copy;
  })();

  function saveIndicators() {
    try { localStorage.setItem("lookupIndicators", JSON.stringify(indicators)); } catch (e) { /* ignore */ }
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function destroyCharts() {
    charts.forEach(function (c) { try { c.remove(); } catch (e) { /* disposed */ } });
    charts = [];
    mainChart = null;
  }
  var destroyChart = destroyCharts; // legacy alias

  // Rolling indicator series aligned to candle times. Pane series are padded
  // with whitespace points so logical bar indices match the main chart.
  function emaSeriesArr(candles, n) {
    var vals = emaArr(candles.map(function (p) { return p.c; }), n);
    var out = [];
    for (var i = 0; i < vals.length; i++) out.push({ time: candles[i + n - 1].time, value: vals[i] });
    return out;
  }

  function bbSeriesArr(candles, n, k) {
    var mid = [], up = [], lo = [], sum = 0, sumSq = 0;
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i].c;
      sum += c; sumSq += c * c;
      if (i >= n) { var d = candles[i - n].c; sum -= d; sumSq -= d * d; }
      if (i >= n - 1) {
        var m = sum / n;
        var sd = Math.sqrt(Math.max(0, sumSq / n - m * m));
        mid.push({ time: candles[i].time, value: m });
        up.push({ time: candles[i].time, value: m + k * sd });
        lo.push({ time: candles[i].time, value: m - k * sd });
      }
    }
    return { mid: mid, up: up, lo: lo };
  }

  function rsiSeriesArr(candles, n) {
    if (candles.length < n + 1) return [];
    var out = [], gain = 0, loss = 0, i, d;
    for (i = 0; i < n; i++) out.push({ time: candles[i].time });
    for (i = 1; i <= n; i++) {
      d = candles[i].c - candles[i - 1].c;
      if (d > 0) gain += d; else loss -= d;
    }
    gain /= n; loss /= n;
    out.push({ time: candles[n].time, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
    for (i = n + 1; i < candles.length; i++) {
      d = candles[i].c - candles[i - 1].c;
      gain = (gain * (n - 1) + Math.max(d, 0)) / n;
      loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
      out.push({ time: candles[i].time, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
    }
    return out;
  }

  function macdSeriesArr(candles, gainC, lossC, fP, sP, sigP) {
    var closes = candles.map(function (p) { return p.c; });
    if (fP >= sP || closes.length < sP + sigP + 1) return null;
    var f = emaArr(closes, fP), s = emaArr(closes, sP);
    var line = [];
    for (var i = 0; i < s.length; i++) line.push(f[i + (sP - fP)] - s[i]);
    var sig = emaArr(line, sigP);
    var out = { line: [], signal: [], hist: [] };
    var startIdx = (sP - 1) + (sigP - 1); // first candle with a signal value
    for (var w = 0; w < startIdx; w++) {
      out.line.push({ time: candles[w].time });
      out.signal.push({ time: candles[w].time });
      out.hist.push({ time: candles[w].time });
    }
    for (var j = 0; j < sig.length; j++) {
      var t = candles[startIdx + j].time;
      var h = line[j + sigP - 1] - sig[j];
      out.line.push({ time: t, value: line[j + sigP - 1] });
      out.signal.push({ time: t, value: sig[j] });
      out.hist.push({ time: t, value: h, color: h >= 0 ? gainC + "88" : lossC + "88" });
    }
    return out;
  }

  // Stochastic %K/%D with %K smoothing, whitespace-padded for pane alignment.
  function stochSeriesArr(candles, kP, kS, dP) {
    var len = candles.length;
    if (len < kP + kS + dP) return null;
    var hi = function (p) { return typeof p.h === "number" ? p.h : p.c; };
    var lo = function (p) { return typeof p.l === "number" ? p.l : p.c; };
    var raw = [];
    for (var i = kP - 1; i < len; i++) {
      var hh = -Infinity, ll = Infinity;
      for (var j = i - kP + 1; j <= i; j++) {
        if (hi(candles[j]) > hh) hh = hi(candles[j]);
        if (lo(candles[j]) < ll) ll = lo(candles[j]);
      }
      raw.push(((candles[i].c - ll) / ((hh - ll) || 1)) * 100);
    }
    var roll = function (vals, n) {
      var out = [], sum = 0;
      for (var x = 0; x < vals.length; x++) {
        sum += vals[x];
        if (x >= n) sum -= vals[x - n];
        if (x >= n - 1) out.push(sum / n);
      }
      return out;
    };
    var kVals = roll(raw, kS);
    var dVals = roll(kVals, dP);
    var kStart = (kP - 1) + (kS - 1), dStart = kStart + (dP - 1);
    var pad = function (start) {
      var arr = [];
      for (var w = 0; w < start; w++) arr.push({ time: candles[w].time });
      return arr;
    };
    var kOut = pad(kStart), dOut = pad(dStart);
    kVals.forEach(function (v, idx) { kOut.push({ time: candles[kStart + idx].time, value: v }); });
    dVals.forEach(function (v, idx) { dOut.push({ time: candles[dStart + idx].time, value: v }); });
    return { k: kOut, d: dOut };
  }

  // Future time slots after the last bar: next trading weekdays for daily
  // series, or the most common bar interval for intraday series.
  function futureTimesFor(candles, count) {
    if (candles.length < 2 || count <= 0) return [];
    var out = [];
    var lastT = candles[candles.length - 1].time;
    if (typeof lastT === "number") {
      var freq = {}, best = 0, step = 0;
      for (var i = Math.max(1, candles.length - 60); i < candles.length; i++) {
        var d = candles[i].time - candles[i - 1].time;
        freq[d] = (freq[d] || 0) + 1;
        if (freq[d] > best) { best = freq[d]; step = d; }
      }
      if (!step) return [];
      for (var j = 1; j <= count; j++) out.push(lastT + j * step);
    } else {
      var dt = new Date(lastT + "T00:00:00Z");
      while (out.length < count) {
        dt.setUTCDate(dt.getUTCDate() + 1);
        var dow = dt.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        out.push(dt.toISOString().slice(0, 10));
      }
    }
    return out;
  }

  // Ichimoku: tenkan/kijun, senkou A/B shifted forward (projected into the
  // future when futureTimes slots are provided), chikou shifted back.
  function ichimokuArr(candles, tP, kP, bP, futureTimes) {
    var len = candles.length;
    if (len < bP + kP) return null;
    var timeAt = function (idx) {
      if (idx < len) return candles[idx].time;
      var f = futureTimes || [];
      return idx - len < f.length ? f[idx - len] : null;
    };
    var hi = function (p) { return typeof p.h === "number" ? p.h : p.c; };
    var lo = function (p) { return typeof p.l === "number" ? p.l : p.c; };
    var midpoint = function (i, n) {
      var hh = -Infinity, ll = Infinity;
      for (var j = i - n + 1; j <= i; j++) {
        if (hi(candles[j]) > hh) hh = hi(candles[j]);
        if (lo(candles[j]) < ll) ll = lo(candles[j]);
      }
      return (hh + ll) / 2;
    };
    var tenkan = [], kijun = [], spanA = [], spanB = [], chikou = [];
    for (var i = 0; i < len; i++) {
      if (i >= tP - 1) tenkan.push({ time: candles[i].time, value: midpoint(i, tP) });
      if (i >= kP - 1) kijun.push({ time: candles[i].time, value: midpoint(i, kP) });
      if (i >= kP - 1 && i >= tP - 1) {
        var tA = timeAt(i + kP);
        if (tA !== null) spanA.push({ time: tA, value: (midpoint(i, tP) + midpoint(i, kP)) / 2 });
      }
      if (i >= bP - 1) {
        var tB = timeAt(i + kP);
        if (tB !== null) spanB.push({ time: tB, value: midpoint(i, bP) });
      }
      if (i >= kP) chikou.push({ time: candles[i - kP].time, value: candles[i].c });
    }
    return { tenkan: tenkan, kijun: kijun, spanA: spanA, spanB: spanB, chikou: chikou };
  }

  // Support/resistance levels from clustered pivot highs/lows over the
  // most recent ~300 bars.
  function srLevelsArr(candles, win, maxN) {
    var rows = candles.slice(-300);
    if (rows.length < win * 2 + 1) return [];
    var hi = function (p) { return typeof p.h === "number" ? p.h : p.c; };
    var lo = function (p) { return typeof p.l === "number" ? p.l : p.c; };
    var piv = [];
    for (var i = win; i < rows.length - win; i++) {
      var isH = true, isL = true;
      for (var j = i - win; j <= i + win; j++) {
        if (j === i) continue;
        if (hi(rows[j]) > hi(rows[i])) isH = false;
        if (lo(rows[j]) < lo(rows[i])) isL = false;
        if (!isH && !isL) break;
      }
      if (isH) piv.push({ p: hi(rows[i]), i: i });
      if (isL) piv.push({ p: lo(rows[i]), i: i });
    }
    piv.sort(function (a, b) { return a.p - b.p; });
    var groups = [];
    piv.forEach(function (v) {
      var g = groups[groups.length - 1];
      if (g && Math.abs(v.p - g.avg) / g.avg < 0.008) {
        g.sum += v.p; g.n++; g.avg = g.sum / g.n;
        if (v.i > g.last) g.last = v.i;
      } else {
        groups.push({ sum: v.p, n: 1, avg: v.p, last: v.i });
      }
    });
    groups.sort(function (a, b) { return (b.n - a.n) || (b.last - a.last); });
    return groups.slice(0, maxN).map(function (g) { return { price: g.avg, touches: g.n }; });
  }

  // Canvas primitive that fills the area between Senkou A and Senkou B
  // (lightweight-charts v4.1+ series primitive API). Drawn below the series.
  function makeCloudPrimitive(ichi, gainC, lossC) {
    var chartRef = null, seriesRef = null;
    var bMap = {};
    ichi.spanB.forEach(function (p) {
      if (typeof p.value === "number") bMap[String(p.time)] = p.value;
    });
    var pts = [];
    ichi.spanA.forEach(function (p) {
      var b = bMap[String(p.time)];
      if (typeof p.value === "number" && typeof b === "number") {
        pts.push({ time: p.time, a: p.value, b: b });
      }
    });
    var renderer = {
      draw: function (target) {
        if (!chartRef || !seriesRef) return;
        target.useBitmapCoordinateSpace(function (scope) {
          var ctx = scope.context;
          var hr = scope.horizontalPixelRatio, vr = scope.verticalPixelRatio;
          var ts = chartRef.timeScale();
          var coords = [];
          for (var i = 0; i < pts.length; i++) {
            var x = ts.timeToCoordinate(pts[i].time);
            if (x === null) { coords.push(null); continue; }
            var ya = seriesRef.priceToCoordinate(pts[i].a);
            var yb = seriesRef.priceToCoordinate(pts[i].b);
            if (ya === null || yb === null) { coords.push(null); continue; }
            coords.push({ x: x * hr, ya: ya * vr, yb: yb * vr, up: pts[i].a >= pts[i].b });
          }
          for (var j = 0; j < coords.length - 1; j++) {
            var p1 = coords[j], p2 = coords[j + 1];
            if (!p1 || !p2) continue;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.ya);
            ctx.lineTo(p2.x, p2.ya);
            ctx.lineTo(p2.x, p2.yb);
            ctx.lineTo(p1.x, p1.yb);
            ctx.closePath();
            ctx.fillStyle = p1.up && p2.up ? gainC + "2e" : !p1.up && !p2.up ? lossC + "2e" : "#9a9aa22a";
            ctx.fill();
          }
        });
      },
    };
    var paneView = {
      renderer: function () { return renderer; },
      zOrder: function () { return "bottom"; },
    };
    return {
      attached: function (p) { chartRef = p.chart; seriesRef = p.series; },
      detached: function () { chartRef = null; seriesRef = null; },
      paneViews: function () { return [paneView]; },
      updateAllViews: function () {},
    };
  }

  // Entry / stop-loss / take-profit suggestion computed from the indicators
  // of the series currently on screen (any timeframe).
  function chartTradePlan(series) {
    if (!series || series.length < 60) return null;
    var closes = series.map(function (p) { return p.c; });
    var close = closes[closes.length - 1];
    var s20 = sma(closes, 20), s50 = sma(closes, 50);
    var atr = atrFromSeries(series, 14);
    if (!isFinite(atr)) atr = close * 0.02;
    var last20 = series.slice(-20);
    var lo = function (p) { return typeof p.l === "number" ? p.l : p.c; };
    var hi = function (p) { return typeof p.h === "number" ? p.h : p.c; };
    var support = Math.min.apply(null, last20.map(lo));
    var resist = Math.max.apply(null, last20.map(hi));
    var trend = close > s20 && s20 > s50 ? "up" : close < s20 && s20 < s50 ? "down" : "side";
    if (trend === "down") return { noEntry: true, reclaim: s20, support: support };
    var entryLo, entryHi, stop, target;
    if (trend === "up") {
      entryLo = s20; entryHi = s20 + atr;
      stop = Math.min(support, s20 - atr);
      target = close >= resist * 0.99 ? close + 2 * atr : resist;
    } else {
      entryLo = support; entryHi = support + atr;
      stop = support - atr;
      target = resist;
    }
    var mid = (entryLo + entryHi) / 2;
    return {
      entryLo: entryLo, entryHi: entryHi, stop: stop, target: target,
      riskPct: ((mid - stop) / mid) * 100,
      rr: stop < mid && target > mid ? (target - mid) / (mid - stop) : NaN,
    };
  }

  function makeChart(el, intraday, showTimeAxis) {
    var text = cssVar("--fg-muted") || "#6b6b6b";
    var border = cssVar("--border") || "#e6e6e2";
    var chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: text,
        fontFamily: getComputedStyle(document.body).fontFamily,
      },
      grid: { vertLines: { color: border }, horzLines: { color: border } },
      rightPriceScale: { borderColor: border, minimumWidth: 64 },
      timeScale: {
        borderColor: border,
        rightOffset: 3,
        visible: !!showTimeAxis,
        timeVisible: !!intraday,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
    });
    charts.push(chart);
    return chart;
  }

  function syncTimeScales() {
    var syncing = false;
    charts.forEach(function (src) {
      src.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
        if (syncing || !range) return;
        syncing = true;
        charts.forEach(function (dst) {
          if (dst !== src) dst.timeScale().setVisibleLogicalRange(range);
        });
        syncing = false;
      });
    });
  }

  function applyRange() {
    if (!mainChart || !view.series || !view.series.length) return;
    if (view.intraday) {
      mainChart.timeScale().fitContent();
      return;
    }
    var r = RANGES.filter(function (x) { return x.label === view.rangeLabel; })[0];
    if (!r || r.interval !== "1d") { mainChart.timeScale().fitContent(); return; }
    var series = view.series;
    var last = series[series.length - 1].d;
    var fromStr;
    if (r.ytd) {
      fromStr = last.slice(0, 4) + "-01-01";
    } else {
      var from = new Date(last + "T00:00:00Z");
      from.setUTCMonth(from.getUTCMonth() - r.months);
      fromStr = from.toISOString().slice(0, 10);
    }
    var first = series[0].d;
    var toStr = futureTail && futureTail.length && typeof futureTail[0] === "string"
      ? futureTail[futureTail.length - 1]
      : last;
    mainChart.timeScale().setVisibleRange({ from: fromStr > first ? fromStr : first, to: toStr });
  }

  function updateLegend() {
    var legend = document.getElementById("chart-legend-items");
    if (!legend) return;
    legend.innerHTML = IND_META.filter(function (m) {
      return indicators[m.key] && m.color && ["rsi", "macd", "stoch"].indexOf(m.key) < 0;
    }).map(function (m) {
      return '<span style="color:' + m.color + '">— ' + indLabel(m.key) + "</span>";
    }).join(" ");
  }

  function drawCharts() {
    if (!window.LightweightCharts || !view.series) return false;
    destroyCharts();
    var series = view.series;
    var mainEl = document.getElementById("lookup-chart");
    var rsiEl = document.getElementById("rsi-pane");
    var stochEl = document.getElementById("stoch-pane");
    var macdEl = document.getElementById("macd-pane");
    if (!mainEl) return false;
    mainEl.innerHTML = "";
    if (rsiEl) { rsiEl.innerHTML = ""; rsiEl.style.display = indicators.rsi ? "" : "none"; }
    if (stochEl) { stochEl.innerHTML = ""; stochEl.style.display = indicators.stoch ? "" : "none"; }
    if (macdEl) { macdEl.innerHTML = ""; macdEl.style.display = indicators.macd ? "" : "none"; }

    var gain = cssVar("--gain") || "#1a7f4b";
    var loss = cssVar("--loss") || "#c0392b";
    var hasOhlc = series.length && typeof series[0].o === "number";
    var bottomPane =
      indicators.macd && macdEl ? "macd" :
      indicators.stoch && stochEl ? "stoch" :
      indicators.rsi && rsiEl ? "rsi" : "main";

    mainChart = makeChart(mainEl, view.intraday, bottomPane === "main");

    var priceSeries;
    if (hasOhlc) {
      priceSeries = mainChart.addCandlestickSeries({
        upColor: gain, downColor: loss,
        borderUpColor: gain, borderDownColor: loss,
        wickUpColor: gain, wickDownColor: loss,
      });
      priceSeries.setData(series.map(function (p) {
        return { time: p.time, open: p.o, high: p.h, low: p.l, close: p.c };
      }));
      if (indicators.vol) {
        var volume = mainChart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volume.setData(series.map(function (p) {
          return { time: p.time, value: p.v || 0, color: p.c >= p.o ? gain + "55" : loss + "55" };
        }));
      }
    } else {
      priceSeries = mainChart.addLineSeries({ color: gain, lineWidth: 2 });
      priceSeries.setData(series.map(function (p) { return { time: p.time, value: p.c }; }));
    }

    var overlayLine = function (data, color, width, style) {
      if (!data || !data.length) return;
      mainChart.addLineSeries({
        color: color, lineWidth: width || 1,
        lineStyle: style || 0,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      }).setData(data);
    };
    if (indicators.sma20 && series.length >= params.sma1) overlayLine(smaSeriesArr(series, params.sma1), "#e6a23c");
    if (indicators.sma50 && series.length >= params.sma2) overlayLine(smaSeriesArr(series, params.sma2), "#5b8def");
    if (indicators.sma200 && series.length >= params.sma3) overlayLine(smaSeriesArr(series, params.sma3), "#b06fd8");
    if (indicators.ema20 && series.length >= params.ema) overlayLine(emaSeriesArr(series, params.ema), "#2aa9a9");
    if (indicators.bb && series.length >= params.bbP) {
      var bb = bbSeriesArr(series, params.bbP, params.bbK);
      overlayLine(bb.up, "#9a9aa2", 1, 2);
      overlayLine(bb.mid, "#9a9aa2", 1, 0);
      overlayLine(bb.lo, "#9a9aa2", 1, 2);
    }
    futureTail = indicators.ichi ? futureTimesFor(series, params.ichiK) : null;
    var padFuture = function (arr) {
      if (futureTail && arr) {
        futureTail.forEach(function (t) { arr.push({ time: t }); });
      }
      return arr;
    };
    if (indicators.ichi) {
      var ichi = ichimokuArr(series, params.ichiT, params.ichiK, params.ichiB, futureTail);
      if (ichi) {
        var spanASeries = mainChart.addLineSeries({
          color: "#1a7f4b", lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        spanASeries.setData(ichi.spanA);
        overlayLine(ichi.spanB, "#b06fd8", 1);
        overlayLine(ichi.tenkan, "#e6a23c", 1);
        overlayLine(ichi.kijun, "#c0392b", 1);
        overlayLine(ichi.chikou, "#9a9aa2", 1, 2);
        if (typeof spanASeries.attachPrimitive === "function") {
          spanASeries.attachPrimitive(makeCloudPrimitive(ichi, gain, loss));
        }
      }
    }
    if (indicators.sr) {
      srLevelsArr(series, params.srWin, params.srMax).forEach(function (lvl) {
        priceSeries.createPriceLine({
          price: lvl.price,
          color: "#c9a227",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "S/R",
        });
      });
    }

    var planNote = "";
    if (indicators.plan) {
      var plan = chartTradePlan(series);
      var addPlanLine = function (price, color, style, title) {
        priceSeries.createPriceLine({
          price: price, color: color, lineWidth: 1, lineStyle: style,
          axisLabelVisible: true, title: title,
        });
      };
      if (!plan) {
        planNote = "Entry/SL: chưa đủ dữ liệu trên khung này.";
      } else if (plan.noEntry) {
        addPlanLine(plan.reclaim, "#5b8def", 2, "Chờ vượt");
        addPlanLine(plan.support, loss, 0, "Hỗ trợ");
        planNote = "Entry/SL: xu hướng giảm trên khung này — chưa có điểm mua; chờ giá vượt và giữ trên " +
          fmt.price(plan.reclaim) + " (SMA20), hỗ trợ cần giữ " + fmt.price(plan.support) + ".";
      } else {
        addPlanLine(plan.entryLo, "#5b8def", 2, "Entry");
        addPlanLine(plan.entryHi, "#5b8def", 2, "Entry");
        addPlanLine(plan.stop, loss, 0, "SL");
        addPlanLine(plan.target, gain, 0, "TP");
        planNote = "Entry/SL (theo khung hiện tại): mua " + fmt.price(plan.entryLo) + "–" + fmt.price(plan.entryHi) +
          " · SL " + fmt.price(plan.stop) + " (rủi ro ~" + plan.riskPct.toFixed(1) + "%)" +
          " · TP " + fmt.price(plan.target) +
          (isFinite(plan.rr) ? " · R:R ≈ " + plan.rr.toFixed(1) + ":1" : "") + ". Chỉ mang tính tham khảo.";
      }
    }
    var noteEl = document.getElementById("chart-note");
    if (noteEl && indicators.plan) noteEl.textContent = planNote;

    if (indicators.rsi && rsiEl && series.length >= params.rsi + 1) {
      var rsiChart = makeChart(rsiEl, view.intraday, bottomPane === "rsi");
      var rsiLine = rsiChart.addLineSeries({
        color: "#e6a23c", lineWidth: 1.5,
        priceLineVisible: false, lastValueVisible: true,
      });
      rsiLine.setData(padFuture(rsiSeriesArr(series, params.rsi)));
      [70, 30].forEach(function (lvl) {
        rsiLine.createPriceLine({ price: lvl, color: cssVar("--fg-muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      });
      rsiLine.applyOptions({ autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; } });
    }

    if (indicators.stoch && stochEl) {
      var stoch = stochSeriesArr(series, params.stochK, params.stochKS, params.stochD);
      if (stoch) {
        var stochChart = makeChart(stochEl, view.intraday, bottomPane === "stoch");
        var kLine = stochChart.addLineSeries({
          color: "#2aa9a9", lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: true,
        });
        kLine.setData(padFuture(stoch.k));
        stochChart.addLineSeries({
          color: "#c0392b", lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false,
        }).setData(padFuture(stoch.d));
        [80, 20].forEach(function (lvl) {
          kLine.createPriceLine({ price: lvl, color: cssVar("--fg-muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        });
        kLine.applyOptions({ autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; } });
      }
    }

    if (indicators.macd && macdEl) {
      var macdData = macdSeriesArr(series, gain, loss, params.macdF, params.macdS, params.macdSig);
      if (macdData) {
        var macdChart = makeChart(macdEl, view.intraday, bottomPane === "macd");
        macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }).setData(padFuture(macdData.hist));
        macdChart.addLineSeries({ color: "#5b8def", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false }).setData(padFuture(macdData.line));
        macdChart.addLineSeries({ color: "#e6a23c", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(padFuture(macdData.signal));
      }
    }

    syncTimeScales();
    applyRange();
    updateLegend();
    return true;
  }

  // ---- Analysis ----

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function analyze(data) {
    var series = data.series;
    var closes = series.map(function (p) { return p.c; });
    var recent = closes.slice(-260);
    var last = series[series.length - 1];
    var n = closes.length;
    var sma20v = sma(closes, 20);
    var sma50v = sma(closes, 50);
    var last20 = closes.slice(-20);
    return {
      close: last.c,
      date: last.d,
      pctDay: pctChange(last.c, closes[n - 2]),
      pct5: n > 5 ? pctChange(last.c, closes[n - 6]) : NaN,
      pct21: n > 21 ? pctChange(last.c, closes[n - 22]) : NaN,
      pct63: n > 63 ? pctChange(last.c, closes[n - 64]) : NaN,
      pct126: n > 126 ? pctChange(last.c, closes[n - 127]) : NaN,
      pct252: n > 252 ? pctChange(last.c, closes[n - 253]) : NaN,
      hi52: Math.max.apply(null, recent),
      lo52: Math.min.apply(null, recent),
      support: Math.min.apply(null, last20),
      resist: Math.max.apply(null, last20),
      sma20: sma20v,
      sma50: sma50v,
      sma200: closes.length >= 200 ? sma(closes, 200) : NaN,
      rsi14: rsi(closes.slice(-120), 14),
      trend: last.c > sma20v && sma20v > sma50v ? "up"
        : last.c < sma20v && sma20v < sma50v ? "down" : "side",
    };
  }

  function trendLabel(a) {
    if (a.trend === "up")
      return { cls: "gain", text: "Xu hướng tăng — giá trên SMA20 (" + fmt.price(a.sma20) + ") và SMA20 trên SMA50 (" + fmt.price(a.sma50) + ")." };
    if (a.trend === "down")
      return { cls: "loss", text: "Xu hướng giảm — giá dưới SMA20 (" + fmt.price(a.sma20) + ") và SMA20 dưới SMA50 (" + fmt.price(a.sma50) + ")." };
    return { cls: "flat", text: "Đi ngang / hỗn hợp — giá quanh SMA20 (" + fmt.price(a.sma20) + "), SMA50 tại " + fmt.price(a.sma50) + "." };
  }

  var TREND_VN = { up: "Tăng", down: "Giảm", side: "Đi ngang" };

  function macdVn(m) {
    if (!m) return "n/a";
    if (m.hist > 0) return m.hist >= m.prevHist ? "dương, mở rộng" : "dương, thu hẹp";
    return m.hist <= m.prevHist ? "âm, mở rộng" : "âm, thu hẹp";
  }

  function rsiPhrase(r) {
    if (!isFinite(r)) return "";
    if (r >= 70) return "RSI " + r.toFixed(0) + " đã vào vùng quá mua — thống kê cho thấy xác suất rung lắc hoặc đi ngang để hạ nhiệt tăng lên đáng kể";
    if (r <= 30) return "RSI " + r.toFixed(0) + " ở vùng quá bán — áp lực bán đã kéo dài, dễ xuất hiện nhịp hồi kỹ thuật dù xu hướng chính chưa đổi";
    if (r >= 55) return "RSI " + r.toFixed(0) + " phản ánh động lượng tích cực, bên mua vẫn kiểm soát";
    if (r > 45) return "RSI " + r.toFixed(0) + " trung tính — thị trường đang lưỡng lự";
    return "RSI " + r.toFixed(0) + " cho thấy động lượng suy yếu, lực mua chưa đủ hấp thụ nguồn cung";
  }

  function macdPhrase(m) {
    if (!m) return "";
    if (m.hist > 0 && m.hist >= m.prevHist) return "MACD nằm trên đường tín hiệu với histogram tiếp tục mở rộng — đà tăng còn nguyên vẹn";
    if (m.hist > 0) return "MACD còn trên đường tín hiệu nhưng histogram đang thu hẹp — đà tăng chậm lại, cần quan sát điểm giao cắt xuống";
    if (m.hist <= m.prevHist) return "MACD dưới đường tín hiệu và histogram nới rộng chiều âm — áp lực bán chưa có dấu hiệu dừng";
    return "MACD dưới đường tín hiệu nhưng histogram đang thu hẹp — lực bán yếu dần, tín hiệu sớm của một nhịp hồi";
  }

  function tfPara(label, closes, t) {
    if (!t.trend) {
      return "<p><strong>Khung " + label + ":</strong> chưa đủ dữ liệu lịch sử để đánh giá xu hướng ở khung này.</p>";
    }
    var c = closes[closes.length - 1];
    var vsFast = pctChange(c, t.fast);
    var body;
    if (t.trend === "up") {
      body = "cấu trúc tăng còn nguyên: giá đứng trên cả hai đường trung bình (cách MA nhanh " + fmt.pct(vsFast) +
        ") và MA nhanh vẫn hướng lên trên MA chậm — bên mua đang kiểm soát khung này.";
    } else if (t.trend === "down") {
      body = "cấu trúc giảm chi phối: giá nằm dưới cả hai đường trung bình (thấp hơn MA nhanh " + fmt.pct(vsFast) +
        ") và MA nhanh cắt xuống dưới MA chậm — mọi nhịp hồi ở khung này hiện vẫn là hồi trong xu hướng giảm.";
    } else {
      body = "trạng thái giằng co: giá " + (c > t.fast ? "vừa lấy lại" : "đang mất") + " MA nhanh trong khi hai đường trung bình đi phẳng và bám sát nhau — khung này chưa chọn hướng.";
    }
    var extra = [rsiPhrase(t.rsi), macdPhrase(t.macd)].filter(Boolean).join("; ");
    return "<p><strong>Khung " + label + ":</strong> " + body + (extra ? " " + extra.charAt(0).toUpperCase() + extra.slice(1) + "." : "") + "</p>";
  }

  function buildAnalysis(symbol, data, a) {
    var series = data.series;
    var closesD = series.map(function (p) { return p.c; });
    var closesW = closesPer(series, weekKey);
    var closesM = closesPer(series, monthKey);
    var tf = {
      D: tfState(closesD, 20, 50),
      W: tfState(closesW, 10, 30),
      M: tfState(closesM, 6, 12),
    };
    var labels = { D: "Ngày", W: "Tuần", M: "Tháng" };
    var atr = atrFromSeries(series, 14);
    if (!isFinite(atr)) atr = a.close * 0.02;
    var atrPct = (atr / a.close) * 100;
    var posPct = ((a.close - a.lo52) / ((a.hi52 - a.lo52) || 1)) * 100;

    // Volume trend: 20-session vs 50-session average
    var vols = series.map(function (p) { return p.v || 0; });
    var v20 = sma(vols, 20), v50 = sma(vols, 50);
    var volRatio = isFinite(v20) && v50 > 0 ? v20 / v50 : NaN;

    // Recent golden/death cross (SMA50 vs SMA200 sign flip within ~30 sessions)
    var crossNote = "";
    if (closesD.length >= 231) {
      var diffNow = sma(closesD, 50) - sma(closesD, 200);
      var past = closesD.slice(0, closesD.length - 30);
      var diffPast = sma(past, 50) - sma(past, 200);
      if (diffNow > 0 && diffPast <= 0) crossNote = "Đáng chú ý: SMA50 vừa cắt lên SMA200 (golden cross) trong khoảng 6 tuần gần đây — tín hiệu xác nhận xu hướng tăng trung hạn theo trường phái theo đà.";
      else if (diffNow < 0 && diffPast >= 0) crossNote = "Đáng chú ý: SMA50 vừa cắt xuống SMA200 (death cross) trong khoảng 6 tuần gần đây — cảnh báo xu hướng trung hạn chuyển xấu.";
    }

    var avail = ["D", "W", "M"].filter(function (k) { return tf[k].trend; });
    var score = 0;
    avail.forEach(function (k) {
      score += tf[k].trend === "up" ? 1 : tf[k].trend === "side" ? 0.5 : 0;
    });
    var ratio = avail.length ? score / avail.length : 0;
    var extended = a.close > a.sma20 + 2 * atr;
    var overbought = a.rsi14 >= 70;

    var vClass, verdict;
    if (avail.length < 2) {
      vClass = "neutral";
      verdict = "Chưa đủ dữ liệu lịch sử để so sánh nhiều khung thời gian — nhận định dưới đây chỉ dựa trên khung ngày.";
    } else if (ratio >= 0.8) {
      if (overbought || extended) {
        vClass = "wait";
        verdict = "Xu hướng đồng thuận tăng trên các khung thời gian, nhưng giá đang căng" +
          (overbought ? " (RSI quá mua)" : " (cách xa SMA20 hơn 2×ATR)") +
          " — NÊN CHỜ nhịp điều chỉnh thay vì mua đuổi tại đây.";
      } else {
        vClass = "good";
        verdict = "Các khung thời gian đồng thuận tăng và giá chưa quá căng so với trung bình — đây là ĐIỂM VÀO TƯƠNG ĐỐI THUẬN LỢI nếu tuân thủ dừng lỗ.";
      }
    } else if (ratio >= 0.5) {
      vClass = "neutral";
      verdict = "Các khung thời gian chưa đồng thuận (xu hướng lớn và ngắn hạn lệch nhau) — TRUNG LẬP, vị thế mới nên chờ tín hiệu xác nhận.";
    } else if (tf.D.trend === "down" && (tf.W.trend === "up" || tf.M.trend === "up")) {
      vClass = "wait";
      verdict = "Khung ngày đang điều chỉnh trong khi xu hướng lớn (tuần/tháng) còn tăng — nhịp chỉnh trong uptrend: theo dõi vùng hỗ trợ, CHƯA VỘI bắt đáy cho tới khi có tín hiệu đảo chiều ngắn hạn.";
    } else {
      vClass = "risky";
      verdict = "Đa số khung thời gian nghiêng giảm — mở vị thế mua lúc này RỦI RO CAO; đứng ngoài hoặc chờ cấu trúc giá cải thiện.";
    }

    // 1. Overview paragraph
    var posPhrase = posPct >= 85 ? "sát đỉnh biên độ 52 tuần" :
      posPct >= 60 ? "ở nửa trên biên độ 52 tuần" :
      posPct >= 40 ? "quanh giữa biên độ 52 tuần" :
      posPct >= 15 ? "ở nửa dưới biên độ 52 tuần" : "sát đáy biên độ 52 tuần";
    var overview = "<p>" + esc(symbol) + " đóng cửa gần nhất tại <strong>" + fmt.price(a.close) + "</strong> (" +
      fmt.pct(a.pctDay) + " trong phiên), hiện " + posPhrase + " (phân vị ~" + posPct.toFixed(0) +
      "%, biên độ " + fmt.price(a.lo52) + "–" + fmt.price(a.hi52) + ") và cách đỉnh 52 tuần " +
      fmt.pct(pctChange(a.close, a.hi52)) + ". Hiệu suất gần đây: 1 tuần " + fmt.pct(a.pct5) +
      ", 1 tháng " + fmt.pct(a.pct21) + ", 3 tháng " + fmt.pct(a.pct63) + ", 6 tháng " + fmt.pct(a.pct126) +
      (isFinite(a.pct252) ? ", 1 năm " + fmt.pct(a.pct252) : "") + ".</p>";

    // 2. Timeframe table (TradingView-style rating) + paragraphs
    var closesBy = { D: closesD, W: closesW, M: closesM };
    var tvLabels = { D: "1D (ngày)", W: "1W (tuần)", M: "1M (tháng)" };
    var tvRating = function (t) {
      if (!t.trend) return { label: "—", cls: "flat" };
      var s = t.trend === "up" ? 2 : t.trend === "down" ? -2 : 0, n = 2;
      if (isFinite(t.rsi)) { s += t.rsi >= 55 ? 1 : t.rsi <= 45 ? -1 : 0; n += 1; }
      if (t.macd) { s += t.macd.hist > 0 ? 1 : -1; n += 1; }
      var r = s / n;
      return r >= 0.75 ? { label: "Mua mạnh", cls: "gain" } :
        r >= 0.25 ? { label: "Mua", cls: "gain" } :
        r > -0.25 ? { label: "Trung lập", cls: "flat" } :
        r > -0.75 ? { label: "Bán", cls: "loss" } : { label: "Bán mạnh", cls: "loss" };
    };
    var tfRows = ["D", "W", "M"].map(function (k) {
      var t = tf[k];
      var cs = closesBy[k];
      var chg = cs.length > 1 ? pctChange(cs[cs.length - 1], cs[cs.length - 2]) : NaN;
      var rating = tvRating(t);
      var vsFast = isFinite(t.fast) ? pctChange(cs[cs.length - 1], t.fast) : NaN;
      var vsSlow = isFinite(t.slow) ? pctChange(cs[cs.length - 1], t.slow) : NaN;
      var cell = function (x) {
        return '<td><span class="' + (x >= 0 ? "gain" : "loss") + '">' + fmt.pct(x) + "</span></td>";
      };
      return "<tr><th>" + tvLabels[k] + "</th>" +
        '<td><span class="' + rating.cls + '"><strong>' + rating.label + "</strong></span></td>" +
        "<td>" + (t.trend ? TREND_VN[t.trend] : "Thiếu dữ liệu") + "</td>" +
        cell(chg) +
        "<td>" + (isFinite(t.rsi) ? t.rsi.toFixed(0) : "n/a") + "</td>" +
        "<td>" + macdVn(t.macd) + "</td>" +
        cell(vsFast) + cell(vsSlow) + "</tr>";
    }).join("");
    var tfParas = tfPara("ngày", closesD, tf.D) + tfPara("tuần", closesW, tf.W) + tfPara("tháng", closesM, tf.M);

    // 3. Momentum & money flow
    var flowText = !isFinite(volRatio)
      ? ""
      : volRatio >= 1.2 ? "Khối lượng trung bình 20 phiên cao hơn hẳn nền 50 phiên (×" + volRatio.toFixed(2) + ") — cổ phiếu đang thu hút sự chú ý của dòng tiền; biến động vì thế cũng sẽ mạnh hơn bình thường."
      : volRatio <= 0.8 ? "Khối lượng trung bình 20 phiên chỉ bằng ×" + volRatio.toFixed(2) + " nền 50 phiên — giao dịch đang trầm lắng dần, các cú biến động giá trên nền thanh khoản mỏng có độ tin cậy thấp hơn."
      : "Khối lượng trung bình 20 phiên xấp xỉ nền 50 phiên (×" + volRatio.toFixed(2) + ") — dòng tiền vào ra ổn định, chưa có đột biến.";
    var volaText = atrPct >= 4
      ? "Biến động rất cao: ATR14 ≈ " + fmt.price(atr) + " (~" + atrPct.toFixed(1) + "%/phiên). Với biên độ này, một biến động bất lợi 2–3 phiên có thể xóa cả chục phần trăm — chỉ phù hợp tỷ trọng nhỏ và kỷ luật dừng lỗ chặt."
      : atrPct >= 2 ? "Biến động ở mức cao: ATR14 ≈ " + fmt.price(atr) + " (~" + atrPct.toFixed(1) + "%/phiên) — cần đặt dừng lỗ đủ rộng để không bị quét bởi nhiễu trong phiên."
      : "Biến động ở mức bình thường: ATR14 ≈ " + fmt.price(atr) + " (~" + atrPct.toFixed(1) + "%/phiên).";
    // Bollinger Bands (20, 2) position on the daily frame
    var bbText = "";
    if (closesD.length >= 20) {
      var last20c = closesD.slice(-20);
      var bbMid = sma(closesD, 20);
      var sd = Math.sqrt(last20c.reduce(function (s, x) { return s + (x - bbMid) * (x - bbMid); }, 0) / 20);
      var bbUp = bbMid + 2 * sd, bbLo = bbMid - 2 * sd;
      var bw = ((bbUp - bbLo) / bbMid) * 100;
      bbText = a.close > bbUp
        ? "Giá đang đóng cửa trên dải Bollinger trên (" + fmt.price(bbUp) + ") — trạng thái quá trớn, thường kéo theo nhịp hồi về dải giữa " + fmt.price(bbMid) + "."
        : a.close < bbLo
        ? "Giá đang nằm dưới dải Bollinger dưới (" + fmt.price(bbLo) + ") — bị bán quá trớn, dễ có nhịp nảy kỹ thuật về dải giữa " + fmt.price(bbMid) + "."
        : bw < 8
        ? "Dải Bollinger đang co hẹp (băng thông ~" + bw.toFixed(1) + "%) — biến động nén lại, thường là giai đoạn tích lũy trước một cú bung mạnh; hướng bung sẽ do phe thắng tại " + fmt.price(bbUp) + "/" + fmt.price(bbLo) + " quyết định."
        : "Trong dải Bollinger (20, 2), giá đang ở " + (a.close > bbMid ? "nửa trên (trên dải giữa " + fmt.price(bbMid) + ") — thiên hướng tích cực" : "nửa dưới (dưới dải giữa " + fmt.price(bbMid) + ") — thiên hướng thận trọng") + "; dải trên/dưới tại " + fmt.price(bbUp) + " / " + fmt.price(bbLo) + ".";
    }
    var momentum = "<p>" + [flowText, volaText, bbText, crossNote].filter(Boolean).join(" ") + "</p>";

    // Risk statistics: annualized volatility and 1y max drawdown
    var riskHtml = "";
    if (closesD.length > 30) {
      var rets = [];
      for (var ri = Math.max(1, closesD.length - 252); ri < closesD.length; ri++) {
        rets.push(closesD[ri] / closesD[ri - 1] - 1);
      }
      var mean = rets.reduce(function (s, x) { return s + x; }, 0) / rets.length;
      var variance = rets.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / rets.length;
      var annVol = Math.sqrt(variance) * Math.sqrt(252) * 100;
      var peak = -Infinity, maxDD = 0;
      closesD.slice(-252).forEach(function (c) {
        if (c > peak) peak = c;
        var dd = (c / peak - 1) * 100;
        if (dd < maxDD) maxDD = dd;
      });
      var volTier = annVol >= 60 ? "cực cao — cùng nhóm với các ETF đòn bẩy/cổ phiếu đầu cơ" :
        annVol >= 35 ? "cao hơn hẳn mặt bằng thị trường (SPY thường quanh 12–20%)" :
        annVol >= 18 ? "quanh mặt bằng chung của cổ phiếu riêng lẻ" : "thấp — biến động êm hơn mặt bằng thị trường";
      riskHtml = "<p>Biến động năm hóa (đo trên 12 tháng): <strong>" + annVol.toFixed(0) + "%</strong> — " + volTier +
        ". Mức giảm sâu nhất từ đỉnh trong 12 tháng qua (max drawdown): <strong>" + fmt.pct(maxDD) + "</strong>. " +
        "Hai con số này là thước đo trực tiếp cho việc chọn tỷ trọng: mức thua lỗ bạn từng phải chịu nếu mua đúng đỉnh gần nhất chính là " + fmt.pct(maxDD) +
        ", nên chỉ phân bổ tỷ trọng mà bạn vẫn giữ được kỷ luật khi kịch bản đó lặp lại.</p>";
    }

    // Dividends, splits & earnings
    var lastDate = series[series.length - 1].d;
    var yearAgo = new Date(new Date(lastDate + "T00:00:00Z").getTime() - 365 * 86400e3).toISOString().slice(0, 10);
    var twoYearsAgo = new Date(new Date(lastDate + "T00:00:00Z").getTime() - 730 * 86400e3).toISOString().slice(0, 10);
    var divs = data.dividends || [];
    var ttm = divs.filter(function (d) { return d.date >= yearAgo; });
    var prevTtm = divs.filter(function (d) { return d.date >= twoYearsAgo && d.date < yearAgo; });
    var sumAmt = function (xs) { return xs.reduce(function (s, d) { return s + d.amount; }, 0); };
    var divHtml;
    if (!data.live && !divs.length) {
      divHtml = "<p>Nguồn dữ liệu dự phòng không kèm lịch sử cổ tức — tra lại khi nguồn trực tuyến khả dụng để xem mục này.</p>";
    } else if (!divs.length) {
      divHtml = "<p>Không ghi nhận đợt chi trả cổ tức nào trong 10 năm dữ liệu — toàn bộ lợi nhuận (nếu có) đến từ tăng giá. Điều này thường gặp ở cổ phiếu tăng trưởng và các ETF tái đầu tư.</p>";
    } else {
      var ttmSum = sumAmt(ttm), prevSum = sumAmt(prevTtm);
      var lastDiv = divs[divs.length - 1];
      var growth = prevSum > 0 ? pctChange(ttmSum, prevSum) : NaN;
      divHtml = "<p>Cổ tức 12 tháng gần nhất: <strong>" + ttmSum.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + " " + esc(data.currency) +
        "/cổ phiếu</strong> qua " + ttm.length + " đợt chi trả, tương đương tỷ suất <strong>" + ((ttmSum / a.close) * 100).toFixed(2) + "%/năm</strong> theo giá hiện tại." +
        (isFinite(growth) ? " So với 12 tháng liền trước, tổng cổ tức " + (growth >= 0 ? "tăng " : "giảm ") + fmt.pct(growth) + "." : "") +
        " Đợt gần nhất: " + lastDiv.amount + " " + esc(data.currency) + " (giao dịch không hưởng quyền " + fmt.date(lastDiv.date) + ").</p>";
    }
    var splits = data.splits || [];
    if (splits.length) {
      var lastSplit = splits[splits.length - 1];
      divHtml += "<p>Chia tách gần nhất: tỷ lệ <strong>" + esc(lastSplit.ratio) + "</strong> ngày " + fmt.date(lastSplit.date) +
        (splits.length > 1 ? " (tổng cộng " + splits.length + " lần chia tách trong 10 năm)" : "") + ".</p>";
    }
    var earns = data.earnings || [];
    if (earns.length) {
      var today = new Date().toISOString().slice(0, 10);
      var next = earns.filter(function (d) { return d >= today; })[0];
      var lastPast = earns.filter(function (d) { return d < today; }).pop();
      divHtml += "<p>" + (next ? "Kỳ công bố kết quả kinh doanh (earnings) kế tiếp: <strong>" + fmt.date(next) + "</strong> — giá thường biến động mạnh quanh mốc này, cân nhắc khi đặt dừng lỗ sát." : "") +
        (lastPast ? (next ? " " : "") + "Kỳ earnings gần nhất đã công bố: " + fmt.date(lastPast) + "." : "") + "</p>";
    } else if (data.live) {
      divHtml += '<p class="lookup-name">Lịch earnings không có trong nguồn dữ liệu miễn phí hiện dùng — tham khảo thêm trên trang IR của doanh nghiệp.</p>';
    }

    // Style-based suggestions
    var styleHtml = "<ul>" +
      "<li><strong>Lướt sóng ngắn hạn:</strong> " + (tf.D.trend === "up"
        ? "canh mua tại nhịp chạm SMA20 (" + fmt.price(a.sma20) + ") hoặc breakout " + fmt.price(a.resist) + " kèm khối lượng; thoát nhanh nếu mất đáy phiên trước. Dùng các khung 1D/5D (nến 5–15 phút) để tinh chỉnh điểm vào."
        : tf.D.trend === "down" ? "chỉ phù hợp canh bán/đứng ngoài; nhịp hồi về SMA20 (" + fmt.price(a.sma20) + ") là vùng cân nhắc thoát vị thế cũ, không phải điểm mua mới."
        : "biên tích lũy " + fmt.price(a.support) + "–" + fmt.price(a.resist) + " là sân chơi chính: mua cận dưới, chốt cận trên, dừng lỗ khi giá thoát biên.") + "</li>" +
      "<li><strong>Trung hạn (vài tuần – vài tháng):</strong> " + (tf.W.trend === "up"
        ? "xu hướng tuần vẫn tăng — chiến lược cốt lõi là nắm giữ theo xu hướng, chỉ mua thêm ở các nhịp chỉnh về MA khung tuần và giảm tỷ trọng khi khung tuần mất cấu trúc tăng."
        : tf.W.trend === "down" ? "khung tuần đang giảm — kiên nhẫn đứng ngoài cho tới khi tuần đóng cửa lấy lại MA nhanh; vào sớm lúc này là bắt dao rơi."
        : "khung tuần đi ngang — chờ tuần đóng cửa thoát khỏi biên giằng co rồi đi theo hướng đó sẽ có xác suất cao hơn đoán trước.") + "</li>" +
      "<li><strong>Dài hạn (tích sản):</strong> " + (tf.M.trend === "up"
        ? "xu hướng tháng vẫn tăng" + (isFinite(a.sma200) ? ", giá " + (a.close > a.sma200 ? "trên" : "dưới") + " SMA200 (" + fmt.price(a.sma200) + ")" : "") + " — mua tích lũy định kỳ vẫn hợp lý; các nhịp giảm về SMA200 lịch sử thường là vùng giải ngân tốt."
        : "xu hướng tháng chưa ủng hộ — nếu tích sản định kỳ, cân nhắc chia nhỏ các lần giải ngân và ưu tiên khi giá về vùng đáy biên độ 52 tuần (" + fmt.price(a.lo52) + ").") + "</li>" +
      "</ul>";

    // 4. Trade plan
    var planHtml;
    if (vClass === "risky") {
      planHtml = "<p>Chưa có điểm mua thuận xu hướng. Điều kiện tối thiểu để xem xét lại: giá đóng cửa vượt và giữ trên SMA20 (" +
        fmt.price(a.sma20) + "), sau đó là SMA50 (" + fmt.price(a.sma50) +
        "); trước thời điểm đó, mọi nhịp bật chỉ nên coi là hồi kỹ thuật. Nếu đang nắm giữ, các nhịp hồi về SMA20 là vùng cân nhắc hạ tỷ trọng thay vì trung bình giá xuống.</p>";
    } else if (tf.D.trend === "down") {
      planHtml = "<p>Chờ khung ngày lấy lại SMA20 (" + fmt.price(a.sma20) +
        ") kèm khối lượng cải thiện trước khi vào lệnh; vùng hỗ trợ cần giữ trong lúc chờ là " + fmt.price(a.support) +
        " — thủng vùng này thì kịch bản “chỉnh trong uptrend” chuyển thành xu hướng giảm thực sự.</p>";
    } else {
      var entryLo, entryHi, stop, target, entryNote;
      if (tf.D.trend === "up") {
        entryLo = a.sma20; entryHi = a.sma20 + atr;
        stop = Math.min(a.support, a.sma20 - atr);
        target = a.close >= a.resist * 0.99 ? a.close + 2 * atr : a.resist;
        entryNote = "nhịp điều chỉnh về quanh SMA20";
      } else {
        entryLo = a.support; entryHi = a.support + atr;
        stop = a.support - atr;
        target = a.resist;
        entryNote = "cận dưới biên tích lũy";
      }
      var mid = (entryLo + entryHi) / 2;
      var risk = mid - stop, reward = target - mid;
      var rr = risk > 0 && reward > 0 ? reward / risk : NaN;
      planHtml = "<ul>" +
        "<li><strong>Vùng mua:</strong> " + fmt.price(entryLo) + " – " + fmt.price(entryHi) + " (" + entryNote + ")" +
        (overbought ? "; tuyệt đối tránh mua đuổi khi RSI đang quá mua" : "") + ".</li>" +
        "<li><strong>Dừng lỗ:</strong> dưới " + fmt.price(stop) + " (rủi ro ~" + (((mid - stop) / mid) * 100).toFixed(1) + "% từ vùng mua).</li>" +
        "<li><strong>Mục tiêu gần:</strong> " + fmt.price(target) + " (dư địa ~" + ((reward / mid) * 100).toFixed(1) + "%)" +
        (isFinite(rr) ? " — tỷ lệ lời:lỗ ≈ " + rr.toFixed(1) + ":1" + (rr < 1.5 ? ", khá mỏng: cân nhắc chờ vùng mua thấp hơn để cải thiện tỷ lệ" : "") : "") + ".</li>" +
        "<li><strong>Quản trị vốn:</strong> với ATR ~" + atrPct.toFixed(1) + "%/phiên, chọn khối lượng vị thế sao cho nếu chạm dừng lỗ, thiệt hại không quá 1–2% tổng tài khoản.</li>" +
        "</ul>";
    }

    // 5. Scenarios
    var bullTarget = a.close >= a.resist * 0.99 ? a.close + 2 * atr : a.resist;
    var scenarios = "<ul>" +
      "<li><strong>Kịch bản tăng:</strong> giá vượt " + fmt.price(a.resist) + " (kháng cự 20 phiên) kèm khối lượng lớn → mục tiêu kế tiếp " +
      fmt.price(Math.max(bullTarget, a.hi52 * 0.995)) + (posPct < 85 ? ", xa hơn là đỉnh 52 tuần " + fmt.price(a.hi52) : " (vùng giá chưa từng có, đo bằng 2×ATR)") + ".</li>" +
      "<li><strong>Kịch bản giảm:</strong> thủng " + fmt.price(a.support) + " (hỗ trợ 20 phiên) → hỗ trợ kế tiếp quanh " +
      fmt.price(Math.min(isFinite(a.sma200) ? Math.max(a.sma200, a.lo52) : a.lo52, a.support * 0.97)) +
      (isFinite(a.sma200) && a.sma200 < a.close ? " và SMA200 tại " + fmt.price(a.sma200) : "") + "; khi đó nhận định tích cực bị vô hiệu hóa, ưu tiên bảo toàn vốn.</li>" +
      "<li><strong>Tín hiệu cần theo dõi:</strong> " + (tf.D.macd && tf.D.macd.hist > 0 && tf.D.macd.hist < tf.D.macd.prevHist
        ? "histogram MACD khung ngày đang thu hẹp — nếu cắt xuống dưới 0 kèm giá mất SMA20, động lượng tăng chính thức gãy."
        : tf.D.macd && tf.D.macd.hist < 0 && tf.D.macd.hist > tf.D.macd.prevHist
        ? "histogram MACD khung ngày đang thu hẹp chiều âm — một cú cắt lên 0 kèm giá vượt SMA20 sẽ là tín hiệu hồi phục sớm."
        : "điểm giao cắt MACD khung ngày và phản ứng của giá tại SMA20 (" + fmt.price(a.sma20) + ").") + "</li>" +
      "</ul>";

    return '<div class="lookup-analysis">' +
      "<h2>Phân tích chi tiết " + esc(symbol) + "</h2>" +
      overview +
      "<h2>So sánh khung thời gian</h2>" +
      '<table class="lookup-table tf-table"><thead><tr><th>Khung</th><th>Tín hiệu</th><th>Xu hướng</th><th>% thay đổi</th><th>RSI(14)</th><th>MACD</th><th>Giá/MA nhanh</th><th>Giá/MA chậm</th></tr></thead><tbody>' +
      tfRows + "</tbody></table>" +
      '<p class="lookup-name">Tín hiệu tổng hợp theo kiểu TradingView (xu hướng MA + RSI + MACD của từng khung). % thay đổi = so với 1 phiên / 1 tuần / 1 tháng liền trước. MA nhanh/chậm: khung ngày SMA20/50, tuần SMA10/30, tháng SMA6/12.</p>' +
      tfParas +
      "<h2>Động lượng, dòng tiền và biến động</h2>" +
      momentum +
      "<h2>Thống kê rủi ro</h2>" +
      riskHtml +
      "<h2>Cổ tức, chia tách &amp; earnings</h2>" +
      divHtml +
      "<h2>Đánh giá điểm vào</h2>" +
      '<p class="verdict ' + vClass + '">' + verdict + "</p>" +
      "<h2>Kế hoạch giao dịch tham khảo</h2>" +
      planHtml +
      "<h2>Kịch bản và mức cần theo dõi</h2>" +
      scenarios +
      "<h2>Gợi ý theo phong cách đầu tư</h2>" +
      styleHtml +
      "</div>";
  }

  // ---- Page rendering ----

  function render(symbol, data) {
    var a = analyze(data);
    var t = trendLabel(a);
    var dayCls = a.pctDay >= 0 ? "gain" : "loss";
    var rangeButtons = RANGES.map(function (r) {
      var intradayDisabled = r.interval !== "1d" && !data.live;
      return '<button type="button" class="range-btn' + (r.label === DEFAULT_LABEL ? " active" : "") +
        '" data-label="' + r.label + '"' + (intradayDisabled ? ' disabled title="Khung trong ngày cần nguồn dữ liệu trực tuyến"' : "") +
        ">" + r.label + "</button>";
    }).join("");

    result.innerHTML =
      '<div class="lookup-card">' +
      '<div class="lookup-head"><span class="lookup-symbol">' + esc(symbol) + "</span> " +
      '<span class="lookup-name">' + esc(data.name) + "</span></div>" +
      '<div class="lookup-price"><strong>' + fmt.price(a.close) + "</strong> " + esc(data.currency) +
      ' <span class="' + dayCls + '">' + fmt.pct(a.pctDay) + "</span>" +
      ' <span class="lookup-date">phiên ' + fmt.date(a.date) + "</span></div>" +
      '<div class="range-bar" role="group" aria-label="Khung thời gian">' + rangeButtons +
      '<button type="button" class="range-btn fs-btn" id="fs-btn" title="Toàn màn hình (Esc để thoát)">⛶</button></div>' +
      '<div class="range-bar ind-bar" role="group" aria-label="Chỉ báo">' +
      IND_META.map(function (m) {
        return '<button type="button" class="range-btn ind-btn' + (indicators[m.key] ? " active" : "") +
          '" data-ind="' + m.key + '">' + indLabel(m.key) + "</button>";
      }).join("") +
      '<button type="button" class="range-btn" id="ind-gear" title="Cài đặt thông số chỉ báo">⚙</button></div>' +
      '<div id="ind-settings" class="ind-settings" hidden>' +
      SETTING_GROUPS.map(function (g) {
        return '<div class="set-row"><span class="set-label">' + g.label + "</span>" +
          g.keys.map(function (k) {
            return '<input type="number" min="1" max="500" step="' + (k === "bbK" ? "0.5" : "1") +
              '" data-param="' + k + '" value="' + params[k] + '" aria-label="' + k + '">';
          }).join("") + "</div>";
      }).join("") +
      '<div class="set-row set-actions"><button type="button" id="set-apply" class="range-btn active">Áp dụng</button>' +
      '<button type="button" id="set-reset" class="range-btn">Mặc định</button>' +
      '<span class="lookup-name">Thông số chỉ áp dụng cho biểu đồ; bài phân tích bên dưới dùng bộ tham số chuẩn.</span></div>' +
      "</div>" +
      '<div id="chart-wrap" class="chart-wrap">' +
      '<div id="lookup-chart" class="lookup-chart"></div>' +
      '<div id="rsi-pane" class="lookup-subchart"></div>' +
      '<div id="stoch-pane" class="lookup-subchart"></div>' +
      '<div id="macd-pane" class="lookup-subchart"></div>' +
      "</div>" +
      '<p class="chart-legend"><span id="chart-legend-items"></span> <span id="chart-note"></span></p>' +
      '<table class="lookup-table"><tbody>' +
      "<tr><th>1 tuần / 1 tháng</th><td><span class=\"" + (a.pct5 >= 0 ? "gain" : "loss") + '">' + fmt.pct(a.pct5) + "</span> / <span class=\"" + (a.pct21 >= 0 ? "gain" : "loss") + '">' + fmt.pct(a.pct21) + "</span></td></tr>" +
      "<tr><th>Biên độ 52 tuần</th><td>" + fmt.price(a.lo52) + " – " + fmt.price(a.hi52) + "</td></tr>" +
      "<tr><th>Hỗ trợ / kháng cự (20 phiên)</th><td>" + fmt.price(a.support) + " / " + fmt.price(a.resist) + "</td></tr>" +
      "<tr><th>RSI(14)</th><td>" + (isFinite(a.rsi14) ? a.rsi14.toFixed(0) : "n/a") + "</td></tr>" +
      "</tbody></table>" +
      '<p class="lookup-trend ' + t.cls + '">' + t.text + "</p>" +
      buildAnalysis(symbol, data, a) +
      '<p class="lookup-source">Nguồn: ' + esc(data.source) + "</p>" +
      "</div>";
    result.hidden = false;

    var note = document.getElementById("chart-note");
    view = { series: data.series, intraday: false, rangeLabel: DEFAULT_LABEL };
    if (!drawCharts()) {
      document.getElementById("lookup-chart").innerHTML =
        '<p class="lookup-name">Không tải được thư viện biểu đồ — hiển thị số liệu dạng bảng bên dưới.</p>';
      return;
    }

    Array.prototype.forEach.call(result.querySelectorAll(".range-btn[data-label]"), function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var r = RANGES.filter(function (x) { return x.label === btn.getAttribute("data-label"); })[0];
        if (!r) return;
        var activate = function () {
          Array.prototype.forEach.call(result.querySelectorAll(".range-btn[data-label]"), function (b) {
            b.classList.remove("active");
          });
          btn.classList.add("active");
        };
        if (r.interval === "1d") {
          view = { series: data.series, intraday: false, rangeLabel: r.label };
          drawCharts();
          if (note) note.textContent = "";
          activate();
        } else {
          if (note) note.textContent = "Đang tải nến " + r.interval + "…";
          fetchYahoo(symbol, r.interval, r.range).then(function (intra) {
            view = { series: intra.series, intraday: true, rangeLabel: r.label };
            drawCharts();
            if (note) note.textContent = "Nến " + r.interval + " · " + r.label;
            activate();
          }).catch(function () {
            if (note) note.textContent = "Không tải được dữ liệu khung " + r.label + " — giữ nguyên khung hiện tại.";
          });
        }
      });
    });

    Array.prototype.forEach.call(result.querySelectorAll(".ind-btn"), function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-ind");
        indicators[key] = !indicators[key];
        saveIndicators();
        btn.classList.toggle("active", indicators[key]);
        drawCharts();
      });
    });

    var refreshChipLabels = function () {
      Array.prototype.forEach.call(result.querySelectorAll(".ind-btn"), function (b) {
        b.textContent = indLabel(b.getAttribute("data-ind"));
      });
    };
    var gear = document.getElementById("ind-gear");
    var panel = document.getElementById("ind-settings");
    if (gear && panel) {
      gear.addEventListener("click", function () { panel.hidden = !panel.hidden; });
      document.getElementById("set-apply").addEventListener("click", function () {
        Array.prototype.forEach.call(panel.querySelectorAll("input[data-param]"), function (inp) {
          var v = Number(inp.value);
          if (isFinite(v) && v > 0) params[inp.getAttribute("data-param")] = v;
        });
        saveParams();
        refreshChipLabels();
        drawCharts();
      });
      document.getElementById("set-reset").addEventListener("click", function () {
        for (var k in PARAM_DEFAULTS) params[k] = PARAM_DEFAULTS[k];
        saveParams();
        Array.prototype.forEach.call(panel.querySelectorAll("input[data-param]"), function (inp) {
          inp.value = params[inp.getAttribute("data-param")];
        });
        refreshChipLabels();
        drawCharts();
      });
    }

    var fsBtn = document.getElementById("fs-btn");
    var wrap = document.getElementById("chart-wrap");
    if (fsBtn && wrap && wrap.requestFullscreen) {
      fsBtn.addEventListener("click", function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap.requestFullscreen();
      });
    } else if (fsBtn) {
      fsBtn.style.display = "none";
    }
  }

  function renderError(symbol) {
    destroyChart();
    result.innerHTML =
      '<div class="lookup-card lookup-error"><p>Không lấy được dữ liệu cho <strong>' + esc(symbol) +
      "</strong>. Kiểm tra lại mã (chỉ hỗ trợ cổ phiếu/ETF Mỹ, ví dụ AAPL, MSFT, SPY), hoặc thử lại sau.</p></div>";
    result.hidden = false;
  }

  function renderLoading(symbol) {
    result.innerHTML = '<div class="lookup-card"><p>Đang tải dữ liệu cho <strong>' + esc(symbol) + "</strong>…</p></div>";
    result.hidden = false;
  }

  var busy = false;
  function lookup(rawSymbol) {
    var symbol = rawSymbol.trim().toUpperCase();
    if (!symbol || busy) return;
    if (!/^[A-Z0-9.^=-]{1,12}$/.test(symbol)) {
      renderError(symbol);
      return;
    }
    busy = true;
    renderLoading(symbol);
    fetchYahoo(symbol, "1d", "10y")
      .catch(function () { return fetchSnapshot(symbol); })
      .then(function (data) { render(symbol, data); })
      .catch(function () { renderError(symbol); })
      .then(function () { busy = false; });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    lookup(input.value);
  });
  Array.prototype.forEach.call(document.querySelectorAll(".lookup-chip"), function (chip) {
    chip.addEventListener("click", function () {
      input.value = chip.getAttribute("data-symbol");
      lookup(input.value);
    });
  });

  var params = new URLSearchParams(window.location.search);
  if (params.get("s")) {
    input.value = params.get("s");
    lookup(input.value);
  }
})();
