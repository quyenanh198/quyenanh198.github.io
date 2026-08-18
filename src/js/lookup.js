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

  // ---- Data sources ----
  // Normalized series item: { d, o, h, l, c, v } (o/h/l/v may be missing on
  // legacy snapshot data — the chart then falls back to a line series).

  function fetchYahoo(symbol) {
    var hosts = ["query1", "query2"];
    var attempt = function (idx) {
      if (idx >= hosts.length) return Promise.reject(new Error("yahoo unreachable"));
      var url = "https://" + hosts[idx] + ".finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(symbol) + "?interval=1d&range=10y";
      return fetch(url).then(function (res) {
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
          source: "Yahoo Finance (trực tiếp)",
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
