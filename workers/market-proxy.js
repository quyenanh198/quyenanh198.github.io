// Cloudflare Worker: market data proxy for quyenanh198.github.io/lookup/
//
// Endpoints (GET only):
//   /chart?symbol=AAPL&interval=1d&range=10y
//     -> proxies Yahoo Finance v8 chart API (query1, fallback query2) with
//        proper CORS headers and edge caching.
//   /av?function=TIME_SERIES_INTRADAY&symbol=AAPL&interval=1min&month=2020-03
//     -> proxies Alpha Vantage using the secret ALPHAVANTAGE_KEY (optional);
//        historical months are cached for a week to conserve the 25 req/day
//        free quota. Returns 501 until the key is configured.
//
// Environment variables (Settings -> Variables in the Cloudflare dashboard):
//   ALLOWED_ORIGINS   comma-separated origins allowed to call this worker.
//                     Default: https://quyenanh198.github.io
//   ALPHAVANTAGE_KEY  (secret, optional) Alpha Vantage API key for /av.

const YAHOO_INTERVALS = /^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo)$/;
const YAHOO_RANGES = /^(1d|5d|1mo|3mo|6mo|ytd|1y|2y|5y|10y|max)$/;
const SYMBOL_RE = /^[A-Za-z0-9.^=-]{1,12}$/;
const AV_FUNCTIONS = /^(TIME_SERIES_INTRADAY|TIME_SERIES_DAILY|TIME_SERIES_DAILY_ADJUSTED|TIME_SERIES_WEEKLY|TIME_SERIES_MONTHLY)$/;

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "https://quyenanh198.github.io")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Vary": "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function passThrough(target, ttl, cors, extraHeaders) {
  const res = await fetch(target, {
    headers: extraHeaders || {},
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=" + ttl,
    },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, cors);

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return json({
        ok: true,
        service: "market-proxy",
        usage: {
          chart: "/chart?symbol=AAPL&interval=1d&range=1mo",
          av: "/av?function=TIME_SERIES_INTRADAY&symbol=AAPL&interval=1min&month=2020-03",
        },
      }, 200, cors);
    }

    if (url.pathname === "/chart") {
      const symbol = url.searchParams.get("symbol") || "";
      const interval = url.searchParams.get("interval") || "1d";
      const range = url.searchParams.get("range") || "1y";
      if (!SYMBOL_RE.test(symbol)) return json({ error: "bad symbol" }, 400, cors);
      if (!YAHOO_INTERVALS.test(interval)) return json({ error: "bad interval" }, 400, cors);
      if (!YAHOO_RANGES.test(range)) return json({ error: "bad range" }, 400, cors);

      const path = "/v8/finance/chart/" + encodeURIComponent(symbol.toUpperCase()) +
        "?interval=" + interval + "&range=" + range + "&events=div%2Csplit%2Cearn";
      // Intraday data goes stale fast; daily can sit in cache longer.
      const ttl = interval === "1d" || interval === "1wk" || interval === "1mo" ? 300 : 60;
      // Yahoo sometimes rejects obviously non-browser requests from
      // datacenter IPs; send full browser-like headers.
      const ua = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
      };

      let res = await passThrough("https://query1.finance.yahoo.com" + path, ttl, cors, ua);
      if (res.status >= 400) {
        res = await passThrough("https://query2.finance.yahoo.com" + path, ttl, cors, ua);
      }
      return res;
    }

    if (url.pathname === "/av") {
      if (!env.ALPHAVANTAGE_KEY) {
        return json({ error: "ALPHAVANTAGE_KEY chưa được cấu hình trên worker" }, 501, cors);
      }
      const fn = url.searchParams.get("function") || "TIME_SERIES_INTRADAY";
      const symbol = url.searchParams.get("symbol") || "";
      if (!AV_FUNCTIONS.test(fn)) return json({ error: "function not allowed" }, 400, cors);
      if (!SYMBOL_RE.test(symbol)) return json({ error: "bad symbol" }, 400, cors);

      const params = new URLSearchParams();
      for (const key of ["function", "symbol", "interval", "month", "outputsize", "adjusted", "extended_hours"]) {
        const v = url.searchParams.get(key);
        if (v) params.set(key, v);
      }
      params.set("apikey", env.ALPHAVANTAGE_KEY);
      // A fully elapsed historical month never changes -> cache a week.
      const month = params.get("month") || "";
      const currentMonth = new Date().toISOString().slice(0, 7);
      const ttl = month && month < currentMonth ? 604800 : 300;
      return passThrough("https://www.alphavantage.co/query?" + params.toString(), ttl, cors);
    }

    return json({ error: "not found", endpoints: ["/chart", "/av"] }, 404, cors);
  },
};
