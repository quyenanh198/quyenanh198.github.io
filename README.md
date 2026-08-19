# quyenanh198.github.io

Site cá nhân + nền tảng phân tích thị trường chứng khoán Mỹ **tự vận hành 100%** — build bằng
[Eleventy](https://www.11ty.dev/), chạy trên GitHub Pages, tự động hóa bằng GitHub Actions.
Không backend, không database, không API key trong repo.

**Live site:** https://quyenanh198.github.io

## Tính năng

### 📊 Tra cứu ticker (`/lookup/`)
- Tra bất kỳ cổ phiếu/ETF Mỹ nào, dữ liệu 10 năm, chạy hoàn toàn trên trình duyệt.
- **Biểu đồ nến kiểu TradingView** (thư viện lightweight-charts): khung 1D (nến 5 phút) →
  10Y, volume, fullscreen.
- **Bộ chỉ báo bật/tắt, chỉnh được thông số** (⚙): SMA×3, EMA, Bollinger Bands,
  Ichimoku (mây tô màu, chiếu tương lai), Support/Resistance tự phát hiện từ pivot,
  RSI / Stochastic / MACD ở pane riêng đồng bộ trục thời gian, và **Entry/SL** — gợi ý
  vùng mua, dừng lỗ, chốt lời vẽ thẳng lên biểu đồ theo khung đang xem.
- **Bài phân tích viết tự động** (~900 từ): so sánh khung Ngày/Tuần/Tháng kiểu TradingView,
  động lượng & dòng tiền, thống kê rủi ro, cổ tức/chia tách/earnings, đánh giá điểm vào,
  kế hoạch giao dịch và kịch bản.

### 📰 Báo cáo tự động (`/reports/` + Blog)
GitHub Actions chạy theo lịch, fetch dữ liệu, **viết báo cáo tiếng Việt bằng máy phân tích
theo luật** (không bịa số — mọi con số từ dữ liệu thật), commit và deploy:

| Lịch (giờ San Francisco) | Sản phẩm |
|---|---|
| Thứ 7, ~8:00 sáng | Báo cáo thị trường tuần · Dòng tiền 11 nhóm ngành · Watchlist ticker · **Bài phân tích tuần** (blog, kèm chỉ báo kỹ thuật + vùng mua/bán tham khảo) |
| Ngày 1 hằng tháng, ~8:30 sáng | Báo cáo thị trường tháng (YTD, xếp hạng ngành) · **Bài phân tích tháng** (blog) |

Chạy tay: tab **Actions** → chọn workflow → *Run workflow*, hoặc local `npm run reports:weekly`.

## Kiến trúc

```
                    ┌─ Trình duyệt người xem ──────────────────────────┐
                    │  /lookup/  →  Cloudflare Worker (market-proxy)   │
                    │              → Yahoo Finance (10y + intraday)    │
                    │              ↘ fallback: CORS proxy công cộng,   │
                    │                /api/snapshot.json                │
                    └──────────────────────────────────────────────────┘
GitHub Actions (cron)
  └─ scripts/generate-weekly.mjs | generate-monthly.mjs
       ├─ đọc watchlist từ src/_data/watchlist.json
       ├─ fetch EOD miễn phí: Stooq → fallback Yahoo (không cần key)
       ├─ tính chỉ báo: SMA/RSI/MACD/ATR, RS so SPY, dòng tiền (giá×KL)
       ├─ sinh báo cáo vào src/reports/ + bài phân tích vào src/posts/
       └─ sinh src/api/snapshot.json (OHLCV 130 phiên × watchlist)
  └─ commit vào master → Eleventy build → deploy GitHub Pages
```

## Cấu trúc repo

```
├── .eleventy.js              # cấu hình Eleventy (collections, filters, cache-busting)
├── .github/workflows/
│   ├── deploy.yml            # build + deploy khi push master
│   ├── reports-weekly.yml    # cron thứ 7: báo cáo tuần + bài phân tích + snapshot
│   └── reports-monthly.yml   # cron ngày 1: báo cáo tháng + bài phân tích
├── scripts/
│   ├── README.md             # tài liệu hệ thống báo cáo tự động
│   ├── lib/marketdata.mjs    # data layer (Stooq/Yahoo) + toàn bộ chỉ báo
│   ├── generate-weekly.mjs   # sinh 3 báo cáo tuần + bài blog + snapshot
│   └── generate-monthly.mjs  # sinh báo cáo tháng + bài blog
├── workers/
│   ├── README.md             # hướng dẫn deploy (web/CLI)
│   ├── market-proxy.js       # Cloudflare Worker: proxy Yahoo + Alpha Vantage
│   └── wrangler.jsonc        # cấu hình deploy 1 lệnh
└── src/
    ├── _data/
    │   ├── site.json         # metadata, nav, URL worker (marketProxy)
    │   └── watchlist.json    # ⭐ danh sách ticker/benchmark/sector — sửa ở đây
    ├── _includes/            # layout: base, post, report
    ├── api/snapshot.json     # dữ liệu dự phòng cho /lookup/ (bot tự cập nhật)
    ├── js/lookup.js          # toàn bộ logic tra cứu + biểu đồ + phân tích client-side
    ├── posts/                # bài blog (bài phân tích tự động đăng vào đây)
    ├── reports/              # báo cáo tự động
    └── lookup.njk, reports.njk, blog.njk, index.njk, about.md, contact.md
```

## Phát triển local

```bash
npm ci
npm run serve            # dev server tại localhost:8080
npm run build            # build ra _site/
npm run reports:weekly   # chạy thử generator báo cáo tuần (cần mạng)
```

Test generator offline: đặt `REPORTS_DATA_DIR=<thư mục>` chứa các file `<SYMBOL>.csv`
định dạng Stooq.

## Tùy biến nhanh

| Muốn | Sửa ở |
|---|---|
| Thêm/bớt mã theo dõi | `src/_data/watchlist.json` |
| Đổi lịch báo cáo | `cron` trong `.github/workflows/reports-*.yml` |
| Đổi văn phong/nội dung báo cáo | template trong `scripts/generate-*.mjs` |
| Đổi URL worker dữ liệu | `marketProxy` trong `src/_data/site.json` |
| Thông số chỉ báo biểu đồ | nút ⚙ ngay trên trang `/lookup/` (lưu theo trình duyệt) |

## Miễn trừ trách nhiệm

Toàn bộ báo cáo, phân tích và gợi ý điểm mua/bán trên site được tạo tự động từ dữ liệu
thị trường và chỉ báo kỹ thuật, **chỉ nhằm mục đích thông tin — không phải khuyến nghị
đầu tư**.
