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
        var twoYearsAgo = lastTs - 730 * 86400;
        var divsObj = r.events && r.events.dividends;
        var divHistory = [];
        if (divsObj) {
          Object.keys(divsObj).forEach(function (k) {
            var d = divsObj[k];
            if (isFinite(d.amount) && d.date) divHistory.push({ date: d.date, amount: d.amount });
          });
          divHistory.sort(function (a, b) { return b.date - a.date; });
        }
        var ttmDiv = 0, payments = 0, prevTtmDiv = 0;
        divHistory.forEach(function (d) {
          if (d.date >= yearAgo) { ttmDiv += d.amount; payments++; }
          else if (d.date >= twoYearsAgo) prevTtmDiv += d.amount;
        });
        var meta = r.meta || {};
        return {
          symbol: symbol,
          name: meta.longName || meta.shortName || symbol,
          price: lastClose,
          ttmDivPerShare: ttmDiv,
          prevTtmDivPerShare: prevTtmDiv,
          payments: payments,
          divHistory: divHistory,
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

  function snapshotState() {
    return {
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
    };
  }

  function applyState(saved) {
    while (rowsBody.firstChild) rowsBody.removeChild(rowsBody.firstChild);
    (saved.rows || []).forEach(function (r) { addRow(r.symbol, r.amount); });
    if (!rowsBody.firstChild) addRow("", "");
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
  }

  function savePortfolio() {
    try { localStorage.setItem("pfPortfolio", JSON.stringify(snapshotState())); } catch (e) { /* ignore */ }
  }

  function loadPortfolio() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("pfPortfolio") || "null"); } catch (e) { /* ignore */ }
    if (saved && saved.rows && saved.rows.length) {
      applyState(saved);
    } else {
      addRow("VOO", 10000);
      addRow("SCHD", 10000);
      addRow("", "");
    }
  }

  // ---- Named portfolio lists (localStorage) ----

  function savedLists() {
    try { return JSON.parse(localStorage.getItem("pfSavedLists") || "{}") || {}; } catch (e) { return {}; }
  }

  function writeSavedLists(lists) {
    try { localStorage.setItem("pfSavedLists", JSON.stringify(lists)); } catch (e) { /* ignore */ }
  }

  function refreshSavedSelect() {
    var sel = document.getElementById("pf-saved");
    if (!sel) return;
    var lists = savedLists();
    var names = Object.keys(lists).sort();
    sel.innerHTML = names.length
      ? names.map(function (n) { return "<option>" + esc(n) + "</option>"; }).join("")
      : '<option value="">(chưa có danh mục nào)</option>';
    sel.disabled = !names.length;
  }

  function initSavedListsUI() {
    var sel = document.getElementById("pf-saved");
    var nameInput = document.getElementById("pf-name");
    var saveBtn = document.getElementById("pf-save");
    var loadBtn = document.getElementById("pf-load");
    var delBtn = document.getElementById("pf-delete");
    if (!sel || !saveBtn) return;
    refreshSavedSelect();
    saveBtn.addEventListener("click", function () {
      var name = (nameInput.value || sel.value || "").trim();
      if (!name) { nameInput.focus(); nameInput.placeholder = "Nhập tên trước khi lưu"; return; }
      var lists = savedLists();
      lists[name] = snapshotState();
      writeSavedLists(lists);
      refreshSavedSelect();
      sel.value = name;
      nameInput.value = "";
    });
    loadBtn.addEventListener("click", function () {
      var lists = savedLists();
      if (sel.value && lists[sel.value]) {
        applyState(lists[sel.value]);
        savePortfolio();
      }
    });
    delBtn.addEventListener("click", function () {
      var lists = savedLists();
      if (sel.value && lists[sel.value]) {
        delete lists[sel.value];
        writeSavedLists(lists);
        refreshSavedSelect();
      }
    });
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

  // ---- Allocation donut (SVG, theme-aware, palette validated for both modes) ----

  var PALETTE_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
  var PALETTE_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

  function pickPalette() {
    var attr = document.documentElement.getAttribute("data-theme");
    var dark = attr === "dark" ||
      (attr !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    return dark ? PALETTE_DARK : PALETTE_LIGHT;
  }

  function arcPath(cx, cy, r1, r2, a0, a1) {
    var large = a1 - a0 > Math.PI ? 1 : 0;
    var pt = function (r, a) {
      return (cx + r * Math.cos(a)).toFixed(2) + "," + (cy + r * Math.sin(a)).toFixed(2);
    };
    return "M" + pt(r2, a0) + " A" + r2 + "," + r2 + " 0 " + large + " 1 " + pt(r2, a1) +
      " L" + pt(r1, a1) + " A" + r1 + "," + r1 + " 0 " + large + " 0 " + pt(r1, a0) + " Z";
  }

  // items: [{label, value}] sorted desc; >8 folds into "Khác".
  function allocationSection(items, total) {
    var palette = pickPalette();
    var shown = items.slice(0, 7);
    var rest = items.slice(7);
    if (rest.length) {
      shown.push({
        label: "Khác (" + rest.map(function (r) { return r.label; }).join(", ") + ")",
        value: rest.reduce(function (s, r) { return s + r.value; }, 0),
        other: true,
      });
    }
    shown.forEach(function (it, i) {
      it.color = it.other ? "#8a8a92" : palette[i];
      it.pct = (it.value / total) * 100;
    });

    var cx = 90, cy = 90, r1 = 52, r2 = 86;
    var a = -Math.PI / 2;
    var paths = shown.map(function (it) {
      var span = Math.max(0.0001, (it.value / total) * Math.PI * 2);
      var seg = it.pct >= 99.99
        // full circle: draw as two halves so the arc renders
        ? arcPath(cx, cy, r1, r2, a, a + Math.PI) + " " + arcPath(cx, cy, r1, r2, a + Math.PI, a + Math.PI * 2)
        : arcPath(cx, cy, r1, r2, a, a + span);
      a += span;
      return '<path d="' + seg + '" fill="' + it.color + '" stroke="var(--bg-subtle)" stroke-width="2">' +
        "<title>" + esc(it.label) + ": " + it.pct.toFixed(1) + "% (" + fmtMoney(it.value) + ")</title></path>";
    }).join("");

    var legend = shown.map(function (it) {
      return '<div class="pf-alloc-row"><span class="pf-alloc-dot" style="background:' + it.color + '"></span>' +
        '<span class="pf-alloc-sym">' + esc(it.label) + "</span>" +
        '<span class="pf-alloc-pct">' + it.pct.toFixed(1) + "%</span>" +
        '<span class="pf-sub">' + fmtMoney(it.value) + "</span></div>";
    }).join("");

    return '<div class="pf-alloc">' +
      '<svg viewBox="0 0 180 180" class="pf-donut" role="img" aria-label="Phân bổ tỷ trọng danh mục">' + paths +
      '<text x="90" y="86" text-anchor="middle" fill="var(--fg)" font-size="15" font-weight="600">' + fmtMoney(total) + "</text>" +
      '<text x="90" y="104" text-anchor="middle" fill="var(--fg-muted)" font-size="10">tổng đầu tư</text>' +
      "</svg>" +
      '<div class="pf-alloc-legend">' + legend + "</div></div>";
  }

  // Allocation drift under DRIP: with a shared growth assumption, weights shift
  // only because yields differ (and DCA buys at the initial weights) — so the
  // drift is scenario-independent.
  function allocationDrift(ok, invested, years, dca, gPct, milestones) {
    var gm = Math.pow(1 + gPct / 100, 1 / 12) - 1;
    var vals = ok.map(function (t) { return t.amount; });
    var w0 = ok.map(function (t) { return t.amount / invested; });
    var snaps = { 0: vals.slice() };
    for (var y = 1; y <= years; y++) {
      for (var m = 0; m < 12; m++) {
        for (var i = 0; i < ok.length; i++) {
          vals[i] = vals[i] * (1 + ok[i].yield / 12) * (1 + gm) + dca * w0[i];
        }
      }
      if (milestones.indexOf(y) >= 0) snaps[y] = vals.slice();
    }
    return snaps;
  }

  var fmtDate = function (unix) {
    var d = new Date(unix * 1000);
    var p = function (x) { return x < 10 ? "0" + x : x; };
    return p(d.getUTCDate()) + "/" + p(d.getUTCMonth() + 1) + "/" + d.getUTCFullYear();
  };

  function freqLabel(n) {
    if (n >= 11) return "hằng tháng";
    if (n >= 4) return "hằng quý";
    if (n >= 2) return "nửa năm/lần";
    if (n >= 1) return "mỗi năm";
    return "—";
  }

  function dividendBox(t) {
    var head = '<div class="pf-divbox"><div class="lookup-head"><span class="lookup-symbol">' +
      esc(t.symbol) + "</span> " + '<span class="lookup-name">' + esc(t.name) + "</span></div>";
    if (!t.divHistory.length || t.ttmDivPerShare <= 0) {
      return head + '<p class="pf-sub">Không chi trả cổ tức trong 2 năm gần nhất — lợi nhuận (nếu có) đến từ tăng giá.</p></div>';
    }
    var growth = t.prevTtmDivPerShare > 0
      ? ((t.ttmDivPerShare / t.prevTtmDivPerShare - 1) * 100)
      : NaN;
    var histRows = t.divHistory.slice(0, 8).map(function (d) {
      return "<tr><td>" + fmtDate(d.date) + "</td><td>" + fmtMoney2(d.amount) + "</td><td>" +
        fmtMoney2(d.amount * t.shares) + "</td></tr>";
    }).join("");
    return head +
      '<table class="lookup-table"><tbody>' +
      "<tr><th>Tỷ suất cổ tức (TTM)</th><td>" + (t.yield * 100).toFixed(2) + "%</td></tr>" +
      "<tr><th>Tần suất chi trả</th><td>" + freqLabel(t.payments) + " (" + t.payments + " đợt/12 tháng)</td></tr>" +
      "<tr><th>Cổ tức/CP 12 tháng</th><td>" + fmtMoney2(t.ttmDivPerShare) +
      (isFinite(growth) ? ' <span class="' + (growth >= 0 ? "gain" : "loss") + '">(' + (growth >= 0 ? "+" : "−") + Math.abs(growth).toFixed(1) + "% so với năm trước)</span>" : "") + "</td></tr>" +
      "<tr><th>Bạn nhận (với " + t.shares.toFixed(2) + " CP)</th><td><strong>" + fmtMoney2(t.divYear1) +
      "/năm</strong> ≈ " + fmtMoney2(t.divYear1 / 12) + "/tháng</td></tr>" +
      "</tbody></table>" +
      '<p class="pf-sub">Các đợt chi trả gần nhất (ngày không hưởng quyền · $/CP · bạn nhận):</p>' +
      '<table class="lookup-table pf-hist"><tbody>' + histRows + "</tbody></table>" +
      "</div>";
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

      // Allocation drift table (DRIP only, >1 ticker)
      var driftHtml = "";
      if (drip && ok.length > 1) {
        var driftMs = [10, 20, years].filter(function (y, i2, arr) { return y <= years && arr.indexOf(y) === i2; });
        var snaps = allocationDrift(ok, invested, years, dca, gAvg, driftMs);
        var totalAt = function (arr) { return arr.reduce(function (s, x) { return s + x; }, 0); };
        var driftRows = ok.map(function (t, i2) {
          return "<tr><th>" + esc(t.symbol) + "</th><td>" + ((t.amount / invested) * 100).toFixed(1) + "%</td>" +
            driftMs.map(function (y) {
              var arr = snaps[y];
              return "<td>" + ((arr[i2] / totalAt(arr)) * 100).toFixed(1) + "%</td>";
            }).join("") + "</tr>";
        }).join("");
        driftHtml = "<h2>Tỷ trọng thay đổi theo thời gian (khi DRIP)</h2>" +
          '<table class="lookup-table tf-table"><thead><tr><th>Mã</th><th>Hiện tại</th>' +
          driftMs.map(function (y) { return "<th>Năm " + y + "</th>"; }).join("") +
          "</tr></thead><tbody>" + driftRows + "</tbody></table>" +
          '<p class="pf-sub">Khi tái đầu tư cổ tức, mã có tỷ suất cổ tức cao hơn tự mua thêm nhiều cổ phiếu hơn nên tỷ trọng tăng dần; DCA được giả định mua theo tỷ trọng ban đầu. Sự dịch chuyển này gần như không phụ thuộc kịch bản tăng trưởng vì các mã dùng chung giả định tăng giá.</p>';
      }

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
        "<h2>Phân bổ tỷ trọng</h2>" +
        allocationSection(
          ok.map(function (t) { return { label: t.symbol, value: t.amount }; })
            .sort(function (x, y) { return y.value - x.value; }),
          invested
        ) +
        driftHtml +
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
        "<h2>Chi tiết cổ tức từng mã</h2>" +
        '<div class="pf-divgrid">' + ok.map(dividendBox).join("") + "</div>" +
        "</div>";
      drawChart(document.getElementById("pf-chart"), scenarios, dca > 0 ? scenarios[0].data : null);
    });
  }

  addBtn.addEventListener("click", function () { addRow("", ""); });
  runBtn.addEventListener("click", run);
  loadPortfolio();
  initSavedListsUI();
})();
