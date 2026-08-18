# Market proxy — Cloudflare Worker

Proxy dữ liệu thị trường cho trang `/lookup/`. Giải quyết việc trình duyệt bị chặn CORS khi
gọi thẳng Yahoo Finance, thay cho các CORS proxy công cộng kém ổn định, và (tùy chọn) giấu
Alpha Vantage API key để lấy nến 1 phút lịch sử sâu.

Miễn phí: gói Free của Cloudflare Workers cho 100.000 request/ngày — quá thừa cho nhu cầu cá nhân.

> **Lưu ý (08/2026):** flow "Create application → Start with Hello World" trên dashboard
> Cloudflare đang có lỗi được nhiều người báo cáo (nút Deploy bị xám). Vì vậy hãy dùng
> **Cách 1 (Wrangler CLI)** — không phụ thuộc giao diện dashboard.

## Cách 1 (khuyến nghị): deploy bằng Wrangler CLI — 1 lệnh

Yêu cầu: máy có Node.js (https://nodejs.org, bản LTS) và đã tạo tài khoản miễn phí tại
https://dash.cloudflare.com (chỉ cần email).

```bash
# từ thư mục gốc của repo
cd workers
npx wrangler@latest deploy
```

- Lần đầu chạy, trình duyệt sẽ mở ra để đăng nhập Cloudflare → bấm **Allow**.
- Khi lệnh chạy xong, URL của worker được in ra, dạng:
  `https://market-proxy.<tên-tài-khoản>.workers.dev`
- Kiểm tra nhanh: mở
  `https://market-proxy.<tên-tài-khoản>.workers.dev/chart?symbol=AAPL&interval=1d&range=1mo`
  trên trình duyệt — thấy JSON giá là thành công.

Cập nhật code worker sau này: sửa `market-proxy.js` rồi chạy lại đúng lệnh trên.

## Cách 2: qua dashboard (nếu giao diện cho phép)

1. https://dash.cloudflare.com → menu trái **Workers & Pages** (một số tài khoản hiển thị là
   **Compute (Workers)**).
2. **Create** / **Create application** → chọn template **Hello World** → **Deploy**.
   (Nếu nút Deploy bị xám — lỗi giao diện nêu trên — hãy quay lại Cách 1.)
3. Sau khi deploy bản mẫu, bấm **Edit code**, xóa code mẫu, dán toàn bộ nội dung
   [`market-proxy.js`](./market-proxy.js) → **Deploy**.
4. Trong **Settings → Variables** thêm biến `ALLOWED_ORIGINS` = `https://quyenanh198.github.io`
   (Cách 1 tự có sẵn nhờ `wrangler.jsonc`).

## Sau khi deploy (cả hai cách)

Mở `src/_data/site.json` trong repo này, điền URL worker vào trường `"marketProxy"`, commit
lên `master` — hoặc đưa URL cho Claude làm giúp. Trang `/lookup/` sẽ tự ưu tiên gọi worker.

## Tùy chọn: bật nến 1 phút lịch sử sâu (Alpha Vantage)

1. Lấy API key miễn phí tại https://www.alphavantage.co/support/#api-key (25 request/ngày).
2. Thêm secret cho worker:
   - CLI: `cd workers && npx wrangler@latest secret put ALPHAVANTAGE_KEY` (dán key khi được hỏi), hoặc
   - Dashboard: trang worker → **Settings → Variables and Secrets** → Add → Type **Secret**,
     tên `ALPHAVANTAGE_KEY`.
3. Endpoint `/av` sẽ hoạt động, ví dụ:
   `/av?function=TIME_SERIES_INTRADAY&symbol=AAPL&interval=1min&month=2020-03&outputsize=full`
   Worker tự cache các tháng lịch sử trong 7 ngày để tiết kiệm quota 25 request/ngày.

## Bảo mật

- Worker chỉ nhận GET và chỉ có 2 endpoint `/chart`, `/av`; tham số được kiểm tra chặt
  (symbol/interval/range/function nằm trong danh sách cho phép) — không thể bị lợi dụng làm
  open proxy.
- CORS mặc định chỉ cho phép `https://quyenanh198.github.io`. Muốn thêm origin (ví dụ máy
  local khi dev), sửa `ALLOWED_ORIGINS` trong `wrangler.jsonc` (danh sách cách nhau dấu phẩy)
  rồi deploy lại.
- Alpha Vantage key chỉ nằm trong Secret của worker, không bao giờ xuất hiện ở phía trình duyệt.
