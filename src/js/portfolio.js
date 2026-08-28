// Portfolio long-horizon simulator for /portfolio/.
// Fetches real prices + trailing-12-month dividends per ticker (own worker
// first, then public fallbacks), then projects portfolio value over N years
// under three growth scenarios, with optional dividend reinvestment.
(function () {
  "use strict";

  var rowsBody = document.querySelector("#pf-rows tbody");
  var addBtn = document.getElementById("pf-add");
  var runBtn = document.getElementById("pf-run");
  var result = document.getElementById("pf-result");
  if (!rowsBody || !runBtn || !result) return;

  var fmtMoney = function (x) {
    if (!isFinite(x)) return "n/a";
    return "$" + Math.round(x).toLocaleString("en-US");
  };
  var fmtMoney2 = function (x) {
    if (!isFinite(x)) return "n/a";
    return "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  };
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---- Data fetching (worker first, public fallbacks) ----

  function yahooUrl(host, symbol) {
    return "https://" + host + ".finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) + "?interval=1d&range=2y&events=div%2Csplit";
  }

  function fetchWithTimeout(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(
      function (res) { if (timer) clearTimeout(timer); return res; },
      function (err) { if (timer) clearTimeout(timer); throw err; }
    );
  }

  function fetchTicker(symbol) {
    var proxy = (window.MARKET_PROXY || "").replace(/\/+$/, "");
    var urls = [];
    if (proxy) urls.push(proxy + "/chart?symbol=" + encodeURIComponent(symbol) + "&interval=1d&range=2y");
    urls.push(
      yahooUrl("query1", symbol),
      "https://corsproxy.io/?url=" + encodeURIComponent(yahooUrl("query1", symbol)),
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(yahooUrl("query2", symbol))
    );
    var attempt = function (idx) {
      if (idx >= urls.length) return Promise.reject(new Error("unreachable"));
      return fetchWithTimeout(urls[idx], 8000).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (json) {
        var r = json && json.chart && json.chart.result && json.chart.result[0];
        var q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
        if (!r || !r.timestamp || !q) throw new Error("no data");
        var lastClose = NaN, lastTs = 0;
        for (var i = r.timestamp.length - 1; i >= 0; i--) {
          if (typeof q.close[i] === "number" && isFinite(q.close[i])) {
            lastClose = q.close[i];
            lastTs = r.timestamp[i];
            break;
          }
        }
        if (!isFinite(lastClose)) throw new Error("no price");
        var yearAgo = lastTs - 365 * 86400;
        var ttmDiv = 0, payments = 0;
        var divsObj = r.events && r.events.dividends;
        if (divsObj) {
          Object.keys(divsObj).forEach(function (k) {
            var d = divsObj[k];
            if (isFinite(d.amount) && (d.date || 0) >= yearAgo) {
              ttmDiv += d.amount;
              payments++;
            }
          });
        }
        var meta = r.meta || {};
        return {
          symbol: symbol,
          name: meta.longName || meta.shortName || symbol,
          price: lastClose,
          ttmDivPerShare: ttmDiv,
          payments: payments,
          yield: ttmDiv / lastClose,
        };
      }).catch(function () { return attempt(idx + 1); });
    };
    return attempt(0);
  }

  // ---- Projection math ----
  // Monthly compounding so DCA contributions land each month; dividends
  // assumed to grow with portfolio value (constant yield on value). DRIP
  // folds each month's dividends back in.
  function project(invested, yieldRate, growthPct, years, drip, dcaMonthly) {
    var gm = Math.pow(1 + growthPct / 100, 1 / 12) - 1;
    var ym = yieldRate / 12;
    var out = [{ year: 0, value: invested, divYear: 0, divCum: 0, contributed: invested }];
    var v = invested, cum = 0, contributed = invested;
    for (var y = 1; y <= years; y++) {
      var divYear = 0;
      for (var m = 0; m < 12; m++) {
        var divs = v * ym;
        divYear += divs;
        if (drip) v += divs; else cum += divs;
        v = v * (1 + gm) + dcaMonthly;
        contributed += dcaMonthly;
      }
      out.push({ year: y, value: v, divYear: divYear, divCum: cum, contributed: contributed });
    }
    return out;
  }

  // ---- Portfolio rows UI ----

  function addRow(symbol, amount) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="text" class="pf-sym" maxlength="12" spellcheck="false" placeholder="VD: AAPL" value="' + esc(symbol || "") + '"></td>' +
      '<td><input type="number" class="pf-amt" min="0" step="100" placeholder="10000" value="' + (amount || "") + '"></td>' +
      '<td><button type="button" class="range-btn pf-del">✕</button></td>';
    tr.querySelector(".pf-del").addEventListener("click", function () {
      tr.parentNode.removeChild(tr);
      savePortfolio();
    });
    rowsBody.appendChild(tr);
  }

  function readPortfolio() {
    var rows = [];
    Array.prototype.forEach.call(rowsBody.querySelectorAll("tr"), function (tr) {
      var sym = tr.querySelector(".pf-sym").value.trim().toUpperCase();
      var amt = Number(tr.querySelector(".pf-amt").value);
      if (/^[A-Z0-9.^=-]{1,12}$/.test(sym) && isFinite(amt) && amt > 0) {
        rows.push({ symbol: sym, amount: amt });
      }
    });
    return rows;
  }

  function savePortfolio() {
    try {
      localStorage.setItem("pfPortfolio", JSON.stringify({
        rows: readPortfolio(),
        years: Number(document.getElementById("pf-years").value) || 30,
        dca: Number(document.getElementById("pf-dca").value) || 0,
        drip: document.getElementById("pf-drip").checked,
        inflAdj: document.getElementById("pf-infl-adj").checked,
        infl: Number(document.getElementById("pf-infl").value),
        g: {
          weak: Number(document.getElementById("g-weak").value),
          avg: Number(document.getElementById("g-avg").value),
          strong: Number(document.getElementById("g-strong").value),
        },
      }));
    } catch (e) { /* ignore */ }
  }

  function loadPortfolio() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("pfPortfolio") || "null"); } catch (e) { /* ignore */ }
    if (saved && saved.rows && saved.rows.length) {
      saved.rows.forEach(function (r) { addRow(r.symbol, r.amount); });
      if (saved.years) document.getElementById("pf-years").value = saved.years;
      if (isFinite(saved.dca)) document.getElementById("pf-dca").value = saved.dca;
      if (typeof saved.inflAdj === "boolean") document.getElementById("pf-infl-adj").checked = saved.inflAdj;
      if (isFinite(saved.infl)) document.getElementById("pf-infl").value = saved.infl;
      if (typeof saved.drip === "boolean") document.getElementById("pf-drip").checked = saved.drip;
      if (saved.g) {
        if (isFinite(saved.g.weak)) document.getElementById("g-weak").value = saved.g.weak;
        if (isFinite(saved.g.avg)) document.getElementById("g-avg").value = saved.g.avg;
        if (isFinite(saved.g.strong)) document.getElementById("g-strong").value = saved.g.strong;
      }
    } else {
      addRow("VOO", 10000);
      addRow("SCHD", 10000);
      addRow("", "");
    }
  }

  // ---- Chart ----

  var chart = null;
  function drawChart(el, scenarios, contrib) {
    if (!window.LightweightCharts) {
      el.innerHTML = '<p class="lookup-name">Không tải được thư viện biểu đồ.</p>';
      return;
    }
    if (chart) { try { chart.remove(); } catch (e) { /* disposed */ } chart = null; }
    el.innerHTML = "";
    var text = cssVar("--fg-muted") || "#6b6b6b";
    var border = cssVar("--border") || "#e6e6e2";
    chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: text,
        fontFamily: getComputedStyle(document.body).fontFamily,
      },
      grid: { vertLines: { color: border }, horzLines: { color: border } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
      crosshair: { mode: 0 },
      localization: {
        priceFormatter: function (p) { return "$" + Math.round(p).toLocaleString("en-US"); },
      },
    });
    var startYear = new Date().getFullYear();
    scenarios.forEach(function (sc) {
      chart.addLineSeries({
        color: sc.color, lineWidth: 2, title: sc.label,
        priceLineVisible: false,
      }).setData(sc.data.map(function (p) {
        return { time: (startYear + p.year) + "-01-01", value: Math.round(p.value) };
      }));
    });
    if (contrib) {
      chart.addLineSeries({
        color: text, lineWidth: 1, lineStyle: 2, title: "Vốn đã góp",
        priceLineVisible: false, lastValueVisible: false,
      }).setData(contrib.map(function (p) {
        return { time: (startYear + p.year) + "-01-01", value: Math.round(p.contributed) };
      }));
    }
    chart.timeScale().fitContent();
  }

  // ---- Run ----

  function run() {
    var rows = readPortfolio();
    if (!rows.length) {
      result.hidden = false;
      result.innerHTML = '<div class="lookup-card lookup-error"><p>Hãy nhập ít nhất một mã kèm số tiền đầu tư.</p></div>';
      return;
    }
    savePortfolio();
    var years = Math.min(50, Math.max(5, Number(document.getElementById("pf-years").value) || 30));
    var dca = Math.max(0, Number(document.getElementById("pf-dca").value) || 0);
    var drip = document.getElementById("pf-drip").checked;
    var inflAdj = document.getElementById("pf-infl-adj").checked;
    var infl = Math.max(0, Number(document.getElementById("pf-infl").value) || 0);
    // Real (inflation-adjusted) growth: (1+g)/(1+π) − 1. DCA stays constant
    // in today's purchasing power (nominal contributions rise with inflation).
    var adjG = function (gPct) {
      return inflAdj ? (((1 + gPct / 100) / (1 + infl / 100)) - 1) * 100 : gPct;
    };
    var gWeak = Number(document.getElementById("g-weak").value);
    var gAvg = Number(document.getElementById("g-avg").value);
    var gStrong = Number(document.getElementById("g-strong").value);

    result.hidden = false;
    result.innerHTML = '<div class="lookup-card"><p>Đang lấy giá và lịch sử cổ tức của ' + rows.length + " mã…</p></div>";
    runBtn.disabled = true;

    Promise.all(rows.map(function (r) {
      return fetchTicker(r.symbol).then(
        function (d) { d.amount = r.amount; return d; },
        function () { return { symbol: r.symbol, error: true, amount: r.amount }; }
      );
    })).then(function (tickers) {
      runBtn.disabled = false;
      var ok = tickers.filter(function (t) { return !t.error; });
      var failed = tickers.filter(function (t) { return t.error; });
      if (!ok.length) {
        result.innerHTML = '<div class="lookup-card lookup-error"><p>Không lấy được dữ liệu cho mã nào (' +
          failed.map(function (t) { return esc(t.symbol); }).join(", ") + "). Kiểm tra lại mã hoặc thử lại sau.</p></div>";
        return;
      }
      var invested = 0, divTotal = 0;
      ok.forEach(function (t) {
        t.shares = t.amount / t.price;
        t.divYear1 = t.shares * t.ttmDivPerShare;
        invested += t.amount;
        divTotal += t.divYear1;
      });
      var portYield = divTotal / invested;

      var gain = cssVar("--gain") || "#1a7f4b";
      var loss = cssVar("--loss") || "#c0392b";
      var scenarios = [
        { key: "weak", label: "Yếu (" + gWeak + "%/năm)", color: loss, g: gWeak },
        { key: "avg", label: "Trung bình (" + gAvg + "%/năm)", color: "#e6a23c", g: gAvg },
        { key: "strong", label: "Mạnh (" + gStrong + "%/năm)", color: gain, g: gStrong },
      ];
      scenarios.forEach(function (sc) {
        sc.data = project(invested, portYield, adjG(sc.g), years, drip, dca);
      });

      // Per-ticker breakdown
      var tickerRows = ok.map(function (t) {
        return "<tr><th>" + esc(t.symbol) + "</th><td>" + esc(t.name) + "</td><td>" + fmtMoney2(t.price) +
          "</td><td>" + t.shares.toFixed(2) + "</td><td>" + (t.yield * 100).toFixed(2) + "%</td><td>" +
          fmtMoney2(t.divYear1) + "</td><td>" + fmtMoney2(t.divYear1 / 12) + "</td></tr>";
      }).join("");

      // Milestone table per scenario
      var milestones = [1, 5, 10, 20, years].filter(function (y, i, a) {
        return y <= years && a.indexOf(y) === i;
      });
      var msHead = "<tr><th>Kịch bản</th>" + milestones.map(function (y) {
        return "<th>Năm " + y + "</th>";
      }).join("") + "</tr>";
      var msRows = scenarios.map(function (sc) {
        return '<tr><th><span style="color:' + sc.color + '">' + sc.label + "</span></th>" +
          milestones.map(function (y) {
            var p = sc.data[y];
            return "<td>" + fmtMoney(p.value) +
              '<br><span class="pf-sub">Cổ tức: ' + fmtMoney(p.divYear) + "/năm · " + fmtMoney(p.divYear / 12) + "/tháng</span>" +
              (dca > 0 ? '<br><span class="pf-sub">Vốn đã góp: ' + fmtMoney(p.contributed) + " · Lãi: " + fmtMoney(p.value - p.contributed + (drip ? 0 : p.divCum)) + "</span>" : "") +
              (!drip && p.divCum > 0 ? '<br><span class="pf-sub">Cổ tức đã nhận lũy kế: ' + fmtMoney(p.divCum) + "</span>" : "") +
              "</td>";
          }).join("") + "</tr>";
      }).join("");

      result.innerHTML =
        '<div class="lookup-card">' +
        "<h2>Danh mục hiện tại</h2>" +
        '<table class="lookup-table tf-table"><thead><tr><th>Mã</th><th>Tên</th><th>Giá</th><th>Số CP</th><th>Yield TTM</th><th>Cổ tức/năm</th><th>Cổ tức/tháng</th></tr></thead><tbody>' +
        tickerRows + "</tbody></table>" +
        "<p>Đầu tư ban đầu <strong>" + fmtMoney(invested) + "</strong>" +
        (dca > 0 ? " + DCA <strong>" + fmtMoney(dca) + "/tháng</strong> (tổng vốn góp sau " + years + " năm: " +
          fmtMoney(invested + dca * 12 * years) + ")" : "") +
        " · tỷ suất cổ tức danh mục <strong>" +
        (portYield * 100).toFixed(2) + "%/năm</strong> → ngay năm đầu nhận khoảng <strong>" + fmtMoney(divTotal) +
        "/năm</strong> (~" + fmtMoney(divTotal / 12) + "/tháng)" +
        (failed.length
          ? '<br><span class="loss">Bỏ qua vì lỗi dữ liệu: ' + failed.map(function (t) { return esc(t.symbol); }).join(", ") + "</span>" +
            '<br><span class="pf-sub">Kiểm tra lại mã (đúng như trên Yahoo Finance). Cổ phiếu ngoài thị trường Mỹ cần hậu tố sàn — ví dụ INTP.JK (Indonesia), 7203.T (Nhật), 0700.HK (Hồng Kông). Nếu bạn định nhập Intel, mã đúng là INTC.</span>'
          : "") +
        "</p>" +
        "<h2>Giá trị danh mục " + years + " năm tới " + (drip ? "(tái đầu tư cổ tức)" : "(nhận cổ tức bằng tiền)") +
        (inflAdj ? " — theo sức mua hôm nay, đã trừ lạm phát " + infl + "%/năm" : "") + "</h2>" +
        (inflAdj
          ? '<p class="pf-sub">Mọi con số bên dưới (giá trị, cổ tức, vốn góp) đều tính theo giá trị thực — tức sức mua tương đương ngày hôm nay. Khoản DCA được giả định tăng danh nghĩa theo lạm phát để giữ nguyên sức mua ' + fmtMoney(dca) + "/tháng.</p>"
          : "") +
        '<div id="pf-chart" class="lookup-chart"></div>' +
        '<p class="chart-legend">' + scenarios.map(function (sc) {
          return '<span style="color:' + sc.color + '">— ' + sc.label + "</span> ";
        }).join("") + (dca > 0 ? '<span class="pf-sub">- - Vốn đã góp</span>' : "") + "</p>" +
        "<h2>Các mốc quan trọng</h2>" +
        '<table class="lookup-table tf-table"><thead>' + msHead + "</thead><tbody>" + msRows + "</tbody></table>" +
        (drip
          ? "<p>Với DRIP, cổ tức mỗi năm được mua thêm cổ phiếu nên tổng tăng trưởng ≈ tăng giá + tỷ suất cổ tức, lãi kép theo cả hai kênh.</p>"
          : "<p>Không tái đầu tư: giá trị danh mục chỉ tăng theo giá; dòng cổ tức nhận bằng tiền được cộng dồn ở mục “Đã nhận lũy kế”.</p>") +
        "</div>";
      drawChart(document.getElementById("pf-chart"), scenarios, dca > 0 ? scenarios[0].data : null);
    });
  }

  addBtn.addEventListener("click", function () { addRow("", ""); });
  runBtn.addEventListener("click", run);
  loadPortfolio();
})();
