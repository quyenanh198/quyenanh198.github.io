// Instant ticker lookup for /lookup/.
// Primary source: Yahoo Finance chart API fetched directly from the browser.
// Fallback: /api/snapshot.json generated weekly for the site's tracked symbols.
(function () {
  "use strict";

  var form = document.getElementById("lookup-form");
  var input = document.getElementById("lookup-input");
  var result = document.getElementById("lookup-result");
  if (!form || !input || !result) return;

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

  function fetchYahoo(symbol) {
    var hosts = ["query1", "query2"];
    var attempt = function (idx) {
      if (idx >= hosts.length) return Promise.reject(new Error("yahoo unreachable"));
      var url = "https://" + hosts[idx] + ".finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(symbol) + "?interval=1d&range=6mo";
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
          if (typeof c === "number" && isFinite(c)) {
            series.push({ d: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), c: c });
          }
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

  // ---- Rendering ----

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function sparkline(series) {
    var w = 640, h = 120, pad = 4;
    var closes = series.map(function (p) { return p.c; });
    var min = Math.min.apply(null, closes);
    var max = Math.max.apply(null, closes);
    var span = max - min || 1;
    var pts = closes.map(function (c, i) {
      var x = pad + (i / (closes.length - 1)) * (w - 2 * pad);
      var y = h - pad - ((c - min) / span) * (h - 2 * pad);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var up = closes[closes.length - 1] >= closes[0];
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Biểu đồ giá 6 tháng">' +
      '<polyline fill="none" stroke="' + (up ? "var(--gain)" : "var(--loss)") + '" stroke-width="2" points="' + pts.join(" ") + '"/></svg>';
  }

  function analyze(data) {
    var series = data.series;
    var closes = series.map(function (p) { return p.c; });
    var last = series[series.length - 1];
    var prev = closes[closes.length - 2];
    var n = closes.length;
    var sma20v = sma(closes, 20);
    var sma50v = sma(closes, 50);
    var rsi14 = rsi(closes, 14);
    var close = last.c;
    var trend = close > sma20v && sma20v > sma50v ? "up"
      : close < sma20v && sma20v < sma50v ? "down" : "side";
    var recent = closes.slice(-20);
    return {
      close: close,
      date: last.d,
      pctDay: pctChange(close, prev),
      pct5: n > 5 ? pctChange(close, closes[n - 6]) : NaN,
      pct21: n > 21 ? pctChange(close, closes[n - 22]) : NaN,
      hi: Math.max.apply(null, closes),
      lo: Math.min.apply(null, closes),
      support: Math.min.apply(null, recent),
      resist: Math.max.apply(null, recent),
      sma20: sma20v,
      sma50: sma50v,
      rsi14: rsi14,
      trend: trend,
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
    var a = analyze(data);
    var t = trendLabel(a);
    var dayCls = a.pctDay >= 0 ? "gain" : "loss";
    result.innerHTML =
      '<div class="lookup-card">' +
      '<div class="lookup-head"><span class="lookup-symbol">' + esc(symbol) + "</span> " +
      '<span class="lookup-name">' + esc(data.name) + "</span></div>" +
      '<div class="lookup-price"><strong>' + fmt.price(a.close) + "</strong> " + esc(data.currency) +
      ' <span class="' + dayCls + '">' + fmt.pct(a.pctDay) + "</span>" +
      ' <span class="lookup-date">phiên ' + fmt.date(a.date) + "</span></div>" +
      sparkline(data.series) +
      '<table class="lookup-table"><tbody>' +
      "<tr><th>1 tuần / 1 tháng</th><td><span class=\"" + (a.pct5 >= 0 ? "gain" : "loss") + '">' + fmt.pct(a.pct5) + "</span> / <span class=\"" + (a.pct21 >= 0 ? "gain" : "loss") + '">' + fmt.pct(a.pct21) + "</span></td></tr>" +
      "<tr><th>Biên độ 6 tháng</th><td>" + fmt.price(a.lo) + " – " + fmt.price(a.hi) + "</td></tr>" +
      "<tr><th>Hỗ trợ / kháng cự (20 phiên)</th><td>" + fmt.price(a.support) + " / " + fmt.price(a.resist) + "</td></tr>" +
      "<tr><th>RSI(14)</th><td>" + rsiLabel(a.rsi14) + "</td></tr>" +
      "</tbody></table>" +
      '<p class="lookup-trend ' + t.cls + '">' + t.text + "</p>" +
      '<p class="lookup-source">Nguồn: ' + esc(data.source) + "</p>" +
      "</div>";
    result.hidden = false;
  }

  function renderError(symbol, hadSnapshotMiss) {
    result.innerHTML =
      '<div class="lookup-card lookup-error"><p>Không lấy được dữ liệu cho <strong>' + esc(symbol) + "</strong>." +
      (hadSnapshotMiss
        ? " Kiểm tra lại mã (chỉ hỗ trợ cổ phiếu/ETF Mỹ, ví dụ AAPL, MSFT, SPY), hoặc thử lại sau."
        : "") + "</p></div>";
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
      renderError(symbol, true);
      return;
    }
    busy = true;
    renderLoading(symbol);
    fetchYahoo(symbol)
      .catch(function () { return fetchSnapshot(symbol); })
      .then(function (data) { render(symbol, data); })
      .catch(function () { renderError(symbol, true); })
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
