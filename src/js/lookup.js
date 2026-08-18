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
  var RANGES = [
    { label: "1D", interval: "5m", range: "1d" },
    { label: "5D", interval: "15m", range: "5d" },
    { label: "1M", interval: "1h", range: "1mo" },
    { label: "3M", interval: "1h", range: "3mo" },
    { label: "6T", interval: "1d", months: 6 },
    { label: "1N", interval: "1d", months: 12 },
    { label: "2N", interval: "1d", months: 24 },
    { label: "5N", interval: "1d", months: 60 },
    { label: "10N", interval: "1d", months: 120 },
  ];
  var DEFAULT_LABEL = "1N";

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
      encodeURIComponent(symbol) + "?interval=" + interval + "&range=" + range;
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
    var urls = [
      yahooUrl("query1", symbol, interval, range),
      "https://corsproxy.io/?url=" + encodeURIComponent(yahooUrl("query1", symbol, interval, range)),
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(yahooUrl("query2", symbol, interval, range)),
    ];
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
        var data = {
          source: "Yahoo Finance",
          live: true,
          intraday: intraday,
          name: meta.longName || meta.shortName || symbol,
          currency: meta.currency || "USD",
          series: series,
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

  // ---- Chart ----

  var chart = null;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function destroyChart() {
    if (chart) {
      try { chart.remove(); } catch (e) { /* already disposed */ }
      chart = null;
    }
  }

  function renderChart(el, series, intraday) {
    if (!window.LightweightCharts) return false;
    destroyChart();
    el.innerHTML = "";
    var hasOhlc = series.length && typeof series[0].o === "number";
    var gain = cssVar("--gain") || "#1a7f4b";
    var loss = cssVar("--loss") || "#c0392b";
    var text = cssVar("--fg-muted") || "#6b6b6b";
    var border = cssVar("--border") || "#e6e6e2";

    chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: text,
        fontFamily: getComputedStyle(document.body).fontFamily,
      },
      grid: {
        vertLines: { color: border },
        horzLines: { color: border },
      },
      rightPriceScale: { borderColor: border },
      timeScale: {
        borderColor: border,
        rightOffset: 3,
        timeVisible: !!intraday,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
    });

    if (hasOhlc) {
      var candles = chart.addCandlestickSeries({
        upColor: gain, downColor: loss,
        borderUpColor: gain, borderDownColor: loss,
        wickUpColor: gain, wickDownColor: loss,
      });
      candles.setData(series.map(function (p) {
        return { time: p.time, open: p.o, high: p.h, low: p.l, close: p.c };
      }));
      var volume = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volume.setData(series.map(function (p) {
        return { time: p.time, value: p.v || 0, color: p.c >= p.o ? gain + "55" : loss + "55" };
      }));
    } else {
      var line = chart.addLineSeries({ color: gain, lineWidth: 2 });
      line.setData(series.map(function (p) { return { time: p.time, value: p.c }; }));
    }

    [{ n: 20, color: "#e6a23c" }, { n: 50, color: "#5b8def" }].forEach(function (m) {
      if (series.length >= m.n) {
        chart.addLineSeries({
          color: m.color, lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false,
        }).setData(smaSeriesArr(series, m.n));
      }
    });
    return true;
  }

  function setDailyRange(series, months) {
    if (!chart || !series.length) return;
    var last = series[series.length - 1].d;
    var from = new Date(last + "T00:00:00Z");
    from.setUTCMonth(from.getUTCMonth() - months);
    var fromStr = from.toISOString().slice(0, 10);
    var first = series[0].d;
    chart.timeScale().setVisibleRange({
      from: fromStr > first ? fromStr : first,
      to: last,
    });
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

    // 2. Timeframe table + paragraphs
    var tfRows = ["D", "W", "M"].map(function (k) {
      var t = tf[k];
      return "<tr><th>" + labels[k] + "</th><td>" +
        (t.trend ? TREND_VN[t.trend] : "Thiếu dữ liệu") + "</td><td>" +
        (isFinite(t.rsi) ? t.rsi.toFixed(0) : "n/a") + "</td><td>" +
        macdVn(t.macd) + "</td></tr>";
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
    var momentum = "<p>" + [flowText, volaText, crossNote].filter(Boolean).join(" ") + "</p>";

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
      '<table class="lookup-table"><thead><tr><th>Khung</th><th>Xu hướng</th><th>RSI(14)</th><th>MACD</th></tr></thead><tbody>' +
      tfRows + "</tbody></table>" +
      tfParas +
      "<h2>Động lượng, dòng tiền và biến động</h2>" +
      momentum +
      "<h2>Đánh giá điểm vào</h2>" +
      '<p class="verdict ' + vClass + '">' + verdict + "</p>" +
      "<h2>Kế hoạch giao dịch tham khảo</h2>" +
      planHtml +
      "<h2>Kịch bản và mức cần theo dõi</h2>" +
      scenarios +
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
      '<div class="range-bar" role="group" aria-label="Khung thời gian">' + rangeButtons + "</div>" +
      '<div id="lookup-chart" class="lookup-chart"></div>' +
      '<p class="chart-legend"><span style="color:#e6a23c">— SMA20</span> <span style="color:#5b8def">— SMA50</span> <span id="chart-note"></span></p>' +
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

    var chartEl = document.getElementById("lookup-chart");
    var note = document.getElementById("chart-note");
    var drawn = renderChart(chartEl, data.series, false);
    if (!drawn) {
      chartEl.innerHTML = '<p class="lookup-name">Không tải được thư viện biểu đồ — hiển thị số liệu dạng bảng bên dưới.</p>';
      return;
    }
    var def = RANGES.filter(function (r) { return r.label === DEFAULT_LABEL; })[0];
    setDailyRange(data.series, def.months);

    Array.prototype.forEach.call(result.querySelectorAll(".range-btn"), function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var r = RANGES.filter(function (x) { return x.label === btn.getAttribute("data-label"); })[0];
        if (!r) return;
        var activate = function () {
          Array.prototype.forEach.call(result.querySelectorAll(".range-btn"), function (b) {
            b.classList.remove("active");
          });
          btn.classList.add("active");
        };
        if (r.interval === "1d") {
          renderChart(chartEl, data.series, false);
          setDailyRange(data.series, r.months);
          if (note) note.textContent = "";
          activate();
        } else {
          if (note) note.textContent = "Đang tải nến " + r.interval + "…";
          fetchYahoo(symbol, r.interval, r.range).then(function (intra) {
            renderChart(chartEl, intra.series, true);
            chart.timeScale().fitContent();
            if (note) note.textContent = "Nến " + r.interval + " · " + r.label;
            activate();
          }).catch(function () {
            if (note) note.textContent = "Không tải được dữ liệu khung " + r.label + " — giữ nguyên khung hiện tại.";
          });
        }
      });
    });
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
