// Instant ticker lookup for /lookup/ with a TradingView-style candlestick
// chart (lightweight-charts). Primary source: Yahoo Finance chart API
// (10 years of daily OHLCV) fetched directly from the browser.
// Fallback: /api/snapshot.json generated weekly for tracked symbols.
(function () {
  "use strict";

  var form = document.getElementById("lookup-form");
  var input = document.getElementById("lookup-input");
  var result = document.getElementById("lookup-result");
  if (!form || !input || !result) return;

  var RANGES = [
    { key: "6mo", label: "6T", months: 6 },
    { key: "1y", label: "1N", months: 12 },
    { key: "2y", label: "2N", months: 24 },
    { key: "5y", label: "5N", months: 60 },
    { key: "10y", label: "10N", months: 120 },
  ];
  var DEFAULT_RANGE = "1y";

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

  function sma(closes, n) {
    if (closes.length < n) return NaN;
    var s = 0;
    for (var i = closes.length - n; i < closes.length; i++) s += closes[i];
    return s / n;
  }

  // Full SMA series aligned with the input candles (null until enough data).
  function smaSeries(candles, n) {
    var out = [], sum = 0;
    for (var i = 0; i < candles.length; i++) {
      sum += candles[i].c;
      if (i >= n) sum -= candles[i - n].c;
      if (i >= n - 1) out.push({ time: candles[i].d, value: sum / n });
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

  // Wilder ATR from OHLC series; NaN when only closes are available.
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

  // Last close of each calendar week / month, for higher-timeframe views.
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
    var st = { trend: null, rsi: NaN, macd: null };
    if (closes.length >= slow) {
      var c = closes[closes.length - 1], f = sma(closes, fast), s = sma(closes, slow);
      st.trend = c > f && f > s ? "up" : c < f && f < s ? "down" : "side";
    }
    if (closes.length >= 15) st.rsi = rsi(closes, 14);
    st.macd = macdLast(closes);
    return st;
  }

  // ---- Data sources ----
  // Normalized series item: { d, o, h, l, c, v } (o/h/l/v may be missing on
  // legacy snapshot data — the chart then falls back to a line series).

  function yahooUrl(host, symbol) {
    return "https://" + host + ".finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) + "?interval=1d&range=10y";
  }

  function fetchWithTimeout(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(
      function (res) { if (timer) clearTimeout(timer); return res; },
      function (err) { if (timer) clearTimeout(timer); throw err; }
    );
  }

  function fetchYahoo(symbol) {
    // Direct calls first; Yahoo blocks cross-origin fetch in most browsers,
    // so public CORS proxies act as the working path for arbitrary symbols.
    var urls = [
      yahooUrl("query1", symbol),
      "https://corsproxy.io/?url=" + encodeURIComponent(yahooUrl("query1", symbol)),
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(yahooUrl("query2", symbol)),
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
            d: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
            o: typeof q.open[i] === "number" ? q.open[i] : c,
            h: typeof q.high[i] === "number" ? q.high[i] : c,
            l: typeof q.low[i] === "number" ? q.low[i] : c,
            c: c,
            v: typeof q.volume[i] === "number" ? q.volume[i] : 0,
          });
        }
        if (series.length < 30) throw new Error("series too short");
        var meta = r.meta || {};
        return {
          source: "Yahoo Finance",
          name: meta.longName || meta.shortName || symbol,
          currency: meta.currency || "USD",
          series: series,
        };
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
        name: entry.name,
        currency: "USD",
        series: entry.series,
      };
    });
  }

  // ---- Chart (lightweight-charts) ----

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

  function renderChart(el, series) {
    if (!window.LightweightCharts) return false;
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
      timeScale: { borderColor: border, rightOffset: 3 },
      crosshair: { mode: 0 },
    });

    if (hasOhlc) {
      var candles = chart.addCandlestickSeries({
        upColor: gain, downColor: loss,
        borderUpColor: gain, borderDownColor: loss,
        wickUpColor: gain, wickDownColor: loss,
      });
      candles.setData(series.map(function (p) {
        return { time: p.d, open: p.o, high: p.h, low: p.l, close: p.c };
      }));
      var volume = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volume.setData(series.map(function (p) {
        return { time: p.d, value: p.v || 0, color: p.c >= p.o ? gain + "55" : loss + "55" };
      }));
    } else {
      var line = chart.addLineSeries({ color: gain, lineWidth: 2 });
      line.setData(series.map(function (p) { return { time: p.d, value: p.c }; }));
    }

    [{ n: 20, color: "#e6a23c" }, { n: 50, color: "#5b8def" }].forEach(function (m) {
      if (series.length >= m.n) {
        chart.addLineSeries({
          color: m.color, lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false,
        }).setData(smaSeries(series, m.n));
      }
    });
    return true;
  }

  function setRange(series, months) {
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

  // ---- Analysis & rendering ----

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function analyze(data) {
    var series = data.series;
    var closes = series.map(function (p) { return p.c; });
    var recent = closes.slice(-260); // ~52 weeks
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
      hi52: Math.max.apply(null, recent),
      lo52: Math.min.apply(null, recent),
      support: Math.min.apply(null, last20),
      resist: Math.max.apply(null, last20),
      sma20: sma20v,
      sma50: sma50v,
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

  function rsiLabel(r) {
    if (!isFinite(r)) return "n/a";
    var v = r.toFixed(0);
    if (r >= 70) return v + " — quá mua, cẩn trọng nhịp rung lắc";
    if (r <= 30) return v + " — quá bán, dễ có nhịp hồi";
    if (r >= 55) return v + " — động lượng tích cực";
    if (r > 45) return v + " — trung tính";
    return v + " — động lượng yếu";
  }

  // ---- Multi-timeframe written analysis ----

  var TREND_VN = { up: "Tăng", down: "Giảm", side: "Đi ngang" };

  function macdVn(m) {
    if (!m) return "n/a";
    if (m.hist > 0) return m.hist >= m.prevHist ? "dương, mở rộng" : "dương, thu hẹp";
    return m.hist <= m.prevHist ? "âm, mở rộng" : "âm, thu hẹp";
  }

  function buildAnalysis(symbol, data, a) {
    var series = data.series;
    var labels = { D: "Ngày", W: "Tuần", M: "Tháng" };
    var tf = {
      D: tfState(series.map(function (p) { return p.c; }), 20, 50),
      W: tfState(closesPer(series, weekKey), 10, 30),
      M: tfState(closesPer(series, monthKey), 6, 12),
    };
    var atr = atrFromSeries(series, 14);
    if (!isFinite(atr)) atr = a.close * 0.02;
    var atrPct = (atr / a.close) * 100;

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

    var tfRows = ["D", "W", "M"].map(function (k) {
      var t = tf[k];
      return "<tr><th>" + labels[k] + "</th><td>" +
        (t.trend ? TREND_VN[t.trend] : "Thiếu dữ liệu") + "</td><td>" +
        (isFinite(t.rsi) ? t.rsi.toFixed(0) : "n/a") + "</td><td>" +
        macdVn(t.macd) + "</td></tr>";
    }).join("");

    var reasons = [];
    avail.forEach(function (k) {
      var t = tf[k];
      reasons.push("Khung " + labels[k].toLowerCase() + ": xu hướng " + TREND_VN[t.trend].toLowerCase() +
        (isFinite(t.rsi) ? ", RSI " + t.rsi.toFixed(0) : "") +
        (t.macd ? ", MACD " + macdVn(t.macd) : "") + ".");
    });
    reasons.push("Giá cách đỉnh 52 tuần " + fmt.pct(pctChange(a.close, a.hi52)) +
      "; hỗ trợ/kháng cự 20 phiên gần nhất: " + fmt.price(a.support) + " / " + fmt.price(a.resist) + ".");
    if (atrPct >= 4) {
      reasons.push("Biến động rất cao (ATR ≈ " + atrPct.toFixed(1) +
        "%/phiên) — biên độ dao động lớn, chỉ phù hợp tỷ trọng nhỏ hoặc giao dịch ngắn hạn.");
    }

    var planHtml = "";
    if (vClass === "risky") {
      planHtml = "<p><strong>Kế hoạch tham khảo:</strong> chưa có điểm mua thuận xu hướng. Điều kiện để xem xét lại: giá đóng cửa vượt và giữ trên SMA20 (" +
        fmt.price(a.sma20) + "), sau đó là SMA50 (" + fmt.price(a.sma50) + "). Nếu đang nắm giữ, các nhịp hồi về SMA20 là vùng cân nhắc hạ tỷ trọng.</p>";
    } else if (tf.D.trend === "down") {
      planHtml = "<p><strong>Kế hoạch tham khảo:</strong> chờ khung ngày lấy lại SMA20 (" + fmt.price(a.sma20) +
        ") kèm khối lượng cải thiện trước khi vào lệnh; vùng hỗ trợ cần giữ là " + fmt.price(a.support) + ".</p>";
    } else {
      var entryLo, entryHi, stop, target;
      if (tf.D.trend === "up") {
        entryLo = a.sma20; entryHi = a.sma20 + atr;
        stop = Math.min(a.support, a.sma20 - atr);
        target = a.close >= a.resist * 0.99 ? a.close + 2 * atr : a.resist;
      } else {
        entryLo = a.support; entryHi = a.support + atr;
        stop = a.support - atr;
        target = a.resist;
      }
      var mid = (entryLo + entryHi) / 2;
      var risk = mid - stop, reward = target - mid;
      var rr = risk > 0 && reward > 0 ? (reward / risk).toFixed(1) : null;
      planHtml = "<p><strong>Kế hoạch tham khảo:</strong></p><ul>" +
        "<li>Vùng mua: " + fmt.price(entryLo) + " – " + fmt.price(entryHi) +
        (tf.D.trend === "up" ? " (nhịp điều chỉnh về SMA20)" : " (cận dưới biên tích lũy)") +
        (overbought ? "; tránh mua đuổi khi RSI đang quá mua" : "") + ".</li>" +
        "<li>Dừng lỗ: dưới " + fmt.price(stop) + " (rủi ro ~" + (((mid - stop) / mid) * 100).toFixed(1) + "% từ vùng mua).</li>" +
        "<li>Mục tiêu gần: " + fmt.price(target) + " (dư địa ~" + ((reward / mid) * 100).toFixed(1) + "%)" +
        (rr ? " — tỷ lệ lời:lỗ ≈ " + rr + ":1" + (Number(rr) < 1.5 ? ", khá mỏng: cân nhắc chờ vùng mua tốt hơn" : "") : "") + ".</li></ul>";
    }

    var invalid = "<p><strong>Kịch bản vô hiệu hóa nhận định:</strong> giá đóng tuần " +
      (vClass === "risky"
        ? "vượt " + fmt.price(a.resist) + " kèm khối lượng lớn sẽ phủ nhận kịch bản giảm."
        : "thủng " + fmt.price(a.support) + " (hỗ trợ 20 phiên) sẽ phủ nhận kịch bản tích cực — khi đó ưu tiên bảo toàn vốn.") + "</p>";

    return '<div class="lookup-analysis">' +
      "<h2>Phân tích chi tiết " + esc(symbol) + "</h2>" +
      '<table class="lookup-table"><thead><tr><th>Khung</th><th>Xu hướng</th><th>RSI(14)</th><th>MACD</th></tr></thead><tbody>' +
      tfRows + "</tbody></table>" +
      '<p class="verdict ' + vClass + '">' + verdict + "</p>" +
      "<ul>" + reasons.map(function (r) { return "<li>" + r + "</li>"; }).join("") + "</ul>" +
      planHtml + invalid +
      "</div>";
  }

  function render(symbol, data) {
    destroyChart();
    var a = analyze(data);
    var t = trendLabel(a);
    var dayCls = a.pctDay >= 0 ? "gain" : "loss";
    var rangeButtons = RANGES.map(function (r) {
      return '<button type="button" class="range-btn' + (r.key === DEFAULT_RANGE ? " active" : "") +
        '" data-months="' + r.months + '">' + r.label + "</button>";
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
      '<p class="chart-legend"><span style="color:#e6a23c">— SMA20</span> <span style="color:#5b8def">— SMA50</span></p>' +
      '<table class="lookup-table"><tbody>' +
      "<tr><th>1 tuần / 1 tháng</th><td><span class=\"" + (a.pct5 >= 0 ? "gain" : "loss") + '">' + fmt.pct(a.pct5) + "</span> / <span class=\"" + (a.pct21 >= 0 ? "gain" : "loss") + '">' + fmt.pct(a.pct21) + "</span></td></tr>" +
      "<tr><th>Biên độ 52 tuần</th><td>" + fmt.price(a.lo52) + " – " + fmt.price(a.hi52) + "</td></tr>" +
      "<tr><th>Hỗ trợ / kháng cự (20 phiên)</th><td>" + fmt.price(a.support) + " / " + fmt.price(a.resist) + "</td></tr>" +
      "<tr><th>RSI(14)</th><td>" + rsiLabel(a.rsi14) + "</td></tr>" +
      "</tbody></table>" +
      '<p class="lookup-trend ' + t.cls + '">' + t.text + "</p>" +
      buildAnalysis(symbol, data, a) +
      '<p class="lookup-source">Nguồn: ' + esc(data.source) + "</p>" +
      "</div>";
    result.hidden = false;

    var chartEl = document.getElementById("lookup-chart");
    var drawn = renderChart(chartEl, data.series);
    if (drawn) {
      var def = RANGES.filter(function (r) { return r.key === DEFAULT_RANGE; })[0];
      setRange(data.series, def.months);
      Array.prototype.forEach.call(result.querySelectorAll(".range-btn"), function (btn) {
        btn.addEventListener("click", function () {
          Array.prototype.forEach.call(result.querySelectorAll(".range-btn"), function (b) {
            b.classList.remove("active");
          });
          btn.classList.add("active");
          setRange(data.series, Number(btn.getAttribute("data-months")));
        });
      });
    } else {
      chartEl.innerHTML = '<p class="lookup-name">Không tải được thư viện biểu đồ — hiển thị số liệu dạng bảng bên dưới.</p>';
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
    fetchYahoo(symbol)
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
